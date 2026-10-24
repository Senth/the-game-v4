import { Children, type ComponentProps, isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { searchPlaces } from "@/app/admin/geocode-actions"
import LazyMap from "@/components/map/lazy-map"
import type { MapViewProps } from "@/components/map/map-view"
import type { PlaceSearchResult } from "@/lib/geocode/nominatim"
import { useAutosaveField } from "./autosave-provider"
import { MapAreaField } from "./map-area-field"

const hooks = vi.hoisted(() => ({ states: [] as unknown[], effects: [] as unknown[][], cursor: 0 }))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useId: () => "map-area",
	useState: (initial: unknown) => {
		const index = hooks.cursor++
		if (!(index in hooks.states))
			hooks.states[index] = typeof initial === "function" ? (initial as () => unknown)() : initial
		return [hooks.states[index], (value: unknown) => (hooks.states[index] = value)]
	},
	useEffect: (effect: () => void, dependencies: unknown[]) => {
		const index = hooks.cursor++
		const previous = hooks.effects[index]
		if (
			!previous ||
			dependencies.some((dependency, dependencyIndex) => !Object.is(dependency, previous[dependencyIndex]))
		) {
			hooks.effects[index] = dependencies
			effect()
		}
	},
}))
vi.mock("@/components/map/lazy-map", () => ({ default: () => <div>Map</div> }))
vi.mock("@/app/admin/geocode-actions", () => ({ searchPlaces: vi.fn() }))
vi.mock("./autosave-provider", () => ({ useAutosaveField: vi.fn() }))

const field = {
	value: null as { lat: number; lng: number; zoom: number } | null,
	onChange: vi.fn(),
	onFocus: vi.fn(),
	onBlur: vi.fn(),
	failed: false,
	error: undefined as string | undefined,
}
const result: PlaceSearchResult = {
	name: "Svedala",
	label: "Svedala, Skåne County, Sweden",
	lat: 55.5079,
	lng: 13.2353,
	bbox: ["55.49", "55.52", "13.20", "13.27"],
}

type InputProps = Pick<ComponentProps<"input">, "onChange" | "value">
type FormProps = Pick<ComponentProps<"form">, "onSubmit">
type ButtonProps = Pick<ComponentProps<"button">, "children" | "onClick">

function descendants<T>(node: ReactNode, type: string): ReactElement<T>[] {
	return Children.toArray(node).flatMap((child) => {
		if (!isValidElement<{ children?: ReactNode }>(child)) return []
		return child.type === type ? [child as ReactElement<T>] : descendants<T>(child.props.children, type)
	})
}

function component(serverValue: typeof field.value = null) {
	hooks.cursor = 0
	return MapAreaField({ serverValue })
}

function render(serverValue: typeof field.value = null) {
	return renderToStaticMarkup(component(serverValue))
}

function mapProps(node: ReactNode): MapViewProps | undefined {
	for (const child of Children.toArray(node)) {
		if (!isValidElement<{ children?: ReactNode }>(child)) continue
		if (child.type === LazyMap) return child.props as MapViewProps
		const found = mapProps(child.props.children)
		if (found) return found
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	hooks.states.length = 0
	hooks.effects.length = 0
	hooks.cursor = 0
	field.value = null
	field.failed = false
	field.error = undefined
	vi.mocked(useAutosaveField).mockReturnValue(field as ReturnType<typeof useAutosaveField>)
})

it("shows map search and not-set guidance without loading a map", () => {
	const html = render()
	expect(useAutosaveField).toHaveBeenCalledWith({ field: "mapArea" }, null)
	expect(html).toContain("Search for where this season plays. New places start there.")
	expect(html).toContain('<label for="map-area-search"')
	expect(html).not.toContain(">Map</div>")
})

it("searches only on submit, picks a result, frames its bounds and saves resulting map centre", async () => {
	vi.mocked(searchPlaces).mockResolvedValue({ ok: true, results: [result] })
	const input = descendants<InputProps>(component(), "input")[0]
	input?.props.onChange?.({ target: { value: "  Svedala  " } } as never)
	expect(searchPlaces).not.toHaveBeenCalled()
	const form = descendants<HTMLFormElement>(component(), "form")[0]
	await form?.props.onSubmit?.({ preventDefault: vi.fn() } as never)
	expect(searchPlaces).toHaveBeenCalledExactlyOnceWith("  Svedala  ")
	const results = component()
	expect(renderToStaticMarkup(results)).toContain("Svedala, Skåne County, Sweden")
	expect(renderToStaticMarkup(results)).toContain("Search © OpenStreetMap contributors")
	const pick = descendants<ButtonProps>(results, "button").find(
		(button) => button.props.children === "Svedala, Skåne County, Sweden",
	)
	pick?.props.onClick?.({} as never)
	const selected = component()
	const map = mapProps(selected)
	expect(map?.minZoom).toBe(2)
	expect(map?.maxZoom).toBe(19)
	expect(map?.framing).toEqual({
		bounds: [
			[13.2, 55.49],
			[13.27, 55.52],
		],
		maxZoom: 17,
	})
	const selectedHtml = renderToStaticMarkup(selected)
	expect(selectedHtml).toContain("New places start on this map. Existing places never change.")
	expect(selectedHtml).not.toContain("Svedala, Skåne County, Sweden</button>")
	map?.onMoveEnd?.({ lat: 55.5079, lng: 13.2353, zoom: 14.26 }, false)
	expect(field.onChange).toHaveBeenCalledExactlyOnceWith({ lat: 55.5079, lng: 13.2353, zoom: 14.26 })
	expect(field.onBlur).toHaveBeenCalledOnce()
})

it("sharpens no-results copy and reports search failure for retry", async () => {
	vi.mocked(searchPlaces).mockResolvedValueOnce({ ok: true, results: [] })
	const input = descendants<InputProps>(component(), "input")[0]
	input?.props.onChange?.({ target: { value: "Nowhere" } } as never)
	await descendants<FormProps>(component(), "form")[0]?.props.onSubmit?.({ preventDefault: vi.fn() } as never)
	expect(render()).toContain("No places match. Check the spelling or try a nearby town.")
	vi.mocked(searchPlaces).mockResolvedValueOnce({ ok: false, error: "unavailable" })
	await descendants<FormProps>(component(), "form")[0]?.props.onSubmit?.({ preventDefault: vi.fn() } as never)
	expect(render()).toContain("Search unavailable. Try again.")
})

it("shows saved centre crosshair and autosaves movement in every season state", () => {
	const area = { lat: 55.5, lng: 13.2, zoom: 12.5 }
	field.value = area
	expect(render(area)).toContain('aria-hidden="true"')
	const map = mapProps(component(area))
	expect(map?.framing).toEqual(area)
	map?.onMoveEnd?.({ lat: 55.5, lng: 13.2, zoom: 12.5 }, false)
	expect(field.onChange).not.toHaveBeenCalled()
	map?.onMoveEnd?.({ lat: 55.51, lng: 13.21, zoom: 13 }, true)
	expect(field.onChange).toHaveBeenCalledExactlyOnceWith({ lat: 55.51, lng: 13.21, zoom: 13 })
	expect(field.onBlur).toHaveBeenCalledOnce()
})

it("frames accepted remote map area after a previously unset value", () => {
	component()
	const area = { lat: 55.5, lng: 13.2, zoom: 12.5 }
	field.value = area
	component(area)
	expect(mapProps(component(area))?.framing).toEqual(area)
})

it("frames accepted remote map area changes", () => {
	const initialArea = { lat: 55.5, lng: 13.2, zoom: 12.5 }
	const remoteArea = { lat: 56.1, lng: 14.3, zoom: 11 }
	field.value = initialArea
	component(initialArea)
	expect(mapProps(component(initialArea))?.framing).toEqual(initialArea)
	field.value = remoteArea
	component(remoteArea)
	expect(mapProps(component(remoteArea))?.framing).toEqual(remoteArea)
})

it("reports rejected search and allows retry", async () => {
	vi.mocked(searchPlaces).mockRejectedValueOnce(new Error("offline"))
	const form = descendants<FormProps>(component(), "form")[0]
	await form?.props.onSubmit?.({ preventDefault: vi.fn() } as never)
	expect(render()).toContain("Search unavailable. Try again.")
	vi.mocked(searchPlaces).mockResolvedValueOnce({ ok: true, results: [result] })
	await descendants<FormProps>(component(), "form")[0]?.props.onSubmit?.({ preventDefault: vi.fn() } as never)
	expect(render()).toContain("Svedala, Skåne County, Sweden")
})
