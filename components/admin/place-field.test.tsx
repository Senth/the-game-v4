import { Children, type ComponentProps, isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import LazyMap from "@/components/map/lazy-map"
import type { MapViewProps } from "@/components/map/map-view"
import { boundsFor, circleRing } from "@/lib/domain/map"
import type { Quest } from "@/lib/domain/schemas"
import { useAutosaveField } from "./autosave-provider"
import { PlaceField } from "./place-field"
import { useMyPosition } from "./use-my-position"

const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0 }))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useId: () => "place",
	useState: (initial: unknown) => {
		const index = hooks.cursor++
		if (!(index in hooks.states))
			hooks.states[index] = typeof initial === "function" ? (initial as () => unknown)() : initial
		return [hooks.states[index], (value: unknown) => (hooks.states[index] = value)]
	},
	useEffect: () => undefined,
	useMemo: (callback: () => unknown) => callback(),
}))
vi.mock("@/components/map/lazy-map", () => ({ default: () => <div>Editor map</div> }))
vi.mock("./use-my-position", () => ({ useMyPosition: vi.fn() }))
vi.mock("./autosave-provider", () => ({
	useAutosaveField: vi.fn(),
	useDraftValue: (_target: unknown, value: unknown) => value,
}))

const place = { id: "place-id", lat: 55.50682, lng: 13.23289, radius: 75 }
const field = {
	value: { guidance: "none", places: [place] } as Quest["location"],
	onChange: vi.fn(),
	onFocus: vi.fn(),
	onBlur: vi.fn(),
	failed: false,
	error: undefined as string | undefined,
}
const props = {
	seasonId: "season",
	arcId: "arc",
	questId: "quest",
	location: null,
	puzzle: null,
	seasonRadius: 40,
	solvedTeams: 0,
}
type InputProps = Pick<ComponentProps<"input">, "aria-label" | "disabled" | "onChange" | "value"> & {
	children?: ReactNode
}
type SwitchProps = Pick<
	ComponentProps<"button">,
	"aria-pressed" | "aria-describedby" | "aria-labelledby" | "className" | "disabled" | "onClick" | "role"
> & { children?: ReactNode }

function inputs(node: ReactNode): ReactElement<InputProps>[] {
	return Children.toArray(node).flatMap((child) => {
		if (!isValidElement<InputProps>(child)) return []
		return child.type === "input" ? [child] : inputs(child.props.children)
	})
}

function switches(node: ReactNode): ReactElement<SwitchProps>[] {
	return Children.toArray(node).flatMap((child) => {
		if (!isValidElement<SwitchProps>(child)) return []
		return child.type === "button" && child.props["aria-pressed"] !== undefined
			? [child]
			: switches(child.props.children)
	})
}

function change(input: ReactElement<InputProps>, value: string) {
	input.props.onChange?.({ target: { value, valueAsNumber: Number(value) } } as never)
}

function component(props: Parameters<typeof PlaceField>[0]) {
	hooks.cursor = 0
	return PlaceField(props)
}

function render(props: Parameters<typeof PlaceField>[0]) {
	hooks.cursor = 0
	return renderToStaticMarkup(<PlaceField {...props} />)
}

beforeEach(() => {
	vi.clearAllMocks()
	hooks.states.length = 0
	hooks.cursor = 0
	field.value = null
	field.failed = false
	field.error = undefined
	vi.mocked(useMyPosition).mockReturnValue({
		waiting: false,
		accuracy: null,
		error: null,
		start: vi.fn(),
		cancel: vi.fn(),
	})
	vi.mocked(useAutosaveField).mockReturnValue(field as ReturnType<typeof useAutosaveField>)
})

it("shows optional Place row and season radius when empty", () => {
	const html = render(props)
	expect(useAutosaveField).toHaveBeenCalledWith({ arcId: "arc", questId: "quest", field: "location" }, null)
	expect(html).toContain("Place")
	expect(html).toContain("optional")
	expect(html).toContain('placeholder="Paste latitude, longitude"')
	expect(html).toContain('aria-label="Place radius"')
	expect(html).toContain('value="40"')
	expect(html).toContain("Empty means players type an answer.")
	expect(html).not.toContain("Check on map")
})

it("shows saved coordinates, radius guidance and editor map without an external map link", () => {
	field.value = { guidance: "none", places: [place] }
	const html = render({ ...props, location: field.value })
	expect(html).toContain('value="55.50682, 13.23289"')
	expect(html).toContain('value="75"')
	expect(html).toContain("Getting within the radius solves it. Players never see the coordinates.")
	expect(html).not.toContain("Check on map")
	expect(html).toContain("Editor map")
	expect(html.indexOf("Getting within the radius solves it.")).toBeLessThan(html.indexOf("Editor map"))
	expect(html.indexOf("Editor map")).toBeLessThan(html.indexOf("Guidance"))
})

it.each([
	["none", "Players get no hint of where the place is."],
	["warmer", "Players see Far, Close or Very close, warmer or colder, and an arrow. Never the spot."],
	["map", "Players see the circle on a map and their own dot."],
] as const)("selects %s guidance and autosaves the whole location with matching helpers", (guidance, helper) => {
	expect(render(props)).not.toContain("Warmer/colder")
	field.value = { guidance, places: [place] }
	const control = switches(component({ ...props, location: field.value }))[["none", "warmer", "map"].indexOf(guidance)]
	if (!control) throw new Error("Guidance control missing")
	expect(control.props["aria-pressed"]).toBe(true)
	expect(render({ ...props, location: field.value })).toContain(helper)
	control.props.onClick?.({} as never)
	expect(field.onChange).toHaveBeenCalledWith({ guidance, places: [place] })
	if (guidance === "map")
		expect(render(props)).toContain("Getting within the radius solves it. Players see this circle.")
})

it("creates a new place from valid coordinates and copies the season radius", () => {
	const coordinates = inputs(component({ ...props, seasonRadius: 125 }))[0]
	if (!coordinates) throw new Error("Coordinates input missing")
	change(coordinates, "55.5079, 13.2353")
	expect(field.onChange).toHaveBeenCalledWith({
		guidance: "none",
		places: [expect.objectContaining({ lat: 55.5079, lng: 13.2353, radius: 125 })],
	})
})

it("shows bad paste error without saving it", () => {
	const coordinates = inputs(component(props))[0]
	if (!coordinates) throw new Error("Coordinates input missing")
	change(coordinates, "55.5079,")
	expect(field.onChange).not.toHaveBeenCalled()
	const html = render(props)
	expect(html).toContain("Paste latitude, longitude, like 55.5079, 13.2353.")
	expect(html).toContain("border-warn")
	expect(html).toContain('aria-invalid="true"')
})

it("updates radius as a whole location and locks both inputs after a solve", () => {
	field.value = { guidance: "none", places: [place] }
	const radius = inputs(component({ ...props, location: field.value }))[1]
	if (!radius) throw new Error("Radius input missing")
	change(radius, "90")
	expect(field.onChange).toHaveBeenCalledWith({ guidance: "none", places: [{ ...place, radius: 90 }] })
	const html = render({ ...props, location: field.value, solvedTeams: 2 })
	expect(html).toContain("Locked: 2 teams have found this place.")
	expect(html).toContain('class="mt-1.5 font-cond text-xs text-head"')
	const guidanceSwitch = switches(component({ ...props, location: field.value, solvedTeams: 2 }))[0]
	expect(guidanceSwitch?.props.disabled).toBe(true)
	expect(guidanceSwitch?.props.className).toContain("disabled:opacity-60")
	expect(
		inputs(component({ ...props, location: field.value, solvedTeams: 2 })).every((input) => input.props.disabled),
	).toBe(true)
})

function mapProps(node: ReactNode): MapViewProps | undefined {
	for (const child of Children.toArray(node)) {
		if (!isValidElement<{ children?: ReactNode }>(child)) continue
		if (child.type === LazyMap) return child.props as MapViewProps
		const found = mapProps(child.props.children)
		if (found) return found
	}
}

it("frames the circle, previews pin movement live without saving and saves the same whole location as paste once on release", () => {
	field.value = { guidance: "map", places: [place] }
	let tree = component(props)
	const map = mapProps(tree)
	expect(map?.framing).toEqual({ bounds: boundsFor(circleRing(place, place.radius)) })
	map?.edit?.onPreview?.({ lat: 55.5079, lng: 13.2353, radius: 75 })
	tree = component(props)
	expect(inputs(tree)[0]?.props.value).toBe("55.5079, 13.2353")
	expect(field.onChange).not.toHaveBeenCalled()
	expect(field.onFocus).toHaveBeenCalledOnce()
	map?.edit?.onMove({ lat: 55.50790001, lng: 13.23530001 })
	const moved = field.onChange.mock.calls[0]?.[0]
	expect(moved).toEqual({ guidance: "map", places: [{ ...place, lat: 55.5079, lng: 13.2353 }] })
	expect(field.onChange).toHaveBeenCalledOnce()
	expect(field.onBlur).toHaveBeenCalledOnce()
	const coordinates = inputs(component(props))[0]
	if (!coordinates) throw new Error("Coordinates input missing")
	change(coordinates, "55.5079, 13.2353")
	expect(field.onChange).toHaveBeenLastCalledWith(moved)
})

it.each([
	[4, 5],
	[500.7, 500],
	[74.6, 75],
])("previews radius live and saves clamped whole radius %s as %s once on release", (radius, expected) => {
	field.value = { guidance: "warmer", places: [place] }
	const map = mapProps(component(props))
	map?.edit?.onPreview?.({ ...place, radius: expected })
	expect(inputs(component(props))[1]?.props.value).toBe(expected)
	expect(field.onChange).not.toHaveBeenCalled()
	map?.edit?.onResize(radius)
	expect(field.onChange).toHaveBeenCalledExactlyOnceWith({
		guidance: "warmer",
		places: [{ ...place, radius: expected }],
	})
	expect(field.onBlur).toHaveBeenCalledOnce()
	const input = inputs(component(props))[1]
	if (!input) throw new Error("Radius input missing")
	change(input, String(expected))
	expect(field.onChange).toHaveBeenLastCalledWith({ guidance: "warmer", places: [{ ...place, radius: expected }] })
})

it("uses the map area only without a place and drops a new place only when empty", () => {
	const mapArea = { lat: 55, lng: 13, zoom: 12 }
	const empty = { ...props, mapArea, seasonRadius: 125 }
	expect(mapProps(component(props))).toBeUndefined()
	expect(render(props)).toContain('href="/admin/seasons/season/settings"')
	expect(render(empty)).toContain("Tap the map to drop the place")
	const map = mapProps(component(empty))
	expect(map?.framing).toEqual(mapArea)
	map?.edit?.onCreate({ lat: 55.50790001, lng: 13.23530001 })
	expect(field.onChange).toHaveBeenCalledExactlyOnceWith({
		guidance: "none",
		places: [expect.objectContaining({ lat: 55.5079, lng: 13.2353, radius: 125 })],
	})
	field.value = { guidance: "map", places: [place] }
	field.onChange.mockClear()
	mapProps(component(empty))?.edit?.onCreate({ lat: 1, lng: 2 })
	expect(field.onChange).not.toHaveBeenCalled()
})

it("uses my position to move a place without changing radius or guidance and disables locked editing", () => {
	field.value = { guidance: "map", places: [place] }
	component(props)
	vi.mocked(useMyPosition).mock.lastCall?.[1]({ lat: 55.1, lng: 13.1 })
	expect(field.onChange).toHaveBeenCalledExactlyOnceWith({
		guidance: "map",
		places: [{ ...place, lat: 55.1, lng: 13.1 }],
	})
	field.onChange.mockClear()
	const locked = { ...props, solvedTeams: 1 }
	expect(mapProps(component(locked))?.edit).toBeNull()
	expect(render(locked)).toContain("Editor map")
	expect(useMyPosition).toHaveBeenLastCalledWith(false, expect.any(Function))
	vi.mocked(useMyPosition).mock.lastCall?.[1]({ lat: 1, lng: 2 })
	expect(field.onChange).not.toHaveBeenCalled()
	expect(render(locked)).toContain('disabled="" class="min-h-11 font-cond text-sm text-link')
})

it("uses my position to create an unguided place with the season radius", () => {
	component({ ...props, seasonRadius: 125 })
	vi.mocked(useMyPosition).mock.lastCall?.[1]({ lat: 55.50790001, lng: 13.23530001 })
	expect(field.onChange).toHaveBeenCalledExactlyOnceWith({
		guidance: "none",
		places: [expect.objectContaining({ lat: 55.5079, lng: 13.2353, radius: 125 })],
	})
	expect(field.onBlur).toHaveBeenCalledOnce()
})

it("shows rough position feedback, Cancel and warning errors", () => {
	vi.mocked(useMyPosition).mockReturnValue({
		waiting: true,
		accuracy: 87,
		error: null,
		start: vi.fn(),
		cancel: vi.fn(),
	})
	expect(render(props)).toContain("◎ Finding you… ±87 m")
	expect(render(props)).toContain("Cancel")
	vi.mocked(useMyPosition).mockReturnValue({
		waiting: false,
		accuracy: null,
		error: "Couldn't get within 50 m. Try outside.",
		start: vi.fn(),
		cancel: vi.fn(),
	})
	expect(render(props)).toContain("Couldn&#x27;t get within 50 m. Try outside.")
	expect(render(props)).toContain("text-warn")
})

it("shows singular lock copy and disables edits", () => {
	field.value = { guidance: "none", places: [place] }
	const html = render({ ...props, location: field.value, solvedTeams: 1 })
	expect(html).toContain("Locked: 1 team has found this place.")
	expect(
		inputs(component({ ...props, location: field.value, solvedTeams: 1 })).every((input) => input.props.disabled),
	).toBe(true)
})

it("blocks Place while puzzle mode is on and clearing coordinates removes the location", () => {
	const blocked = render({ ...props, puzzle: { rows: 4, cols: 4, showFull: false } })
	expect(blocked).toContain("Turn off puzzle mode to add a place.")
	expect(inputs(component({ ...props, puzzle: { rows: 4, cols: 4, showFull: false } }))).toHaveLength(0)
	field.value = { guidance: "none", places: [place] }
	const coordinates = inputs(component({ ...props, location: field.value }))[0]
	if (!coordinates) throw new Error("Coordinates input missing")
	change(coordinates, "")
	expect(field.onChange).toHaveBeenCalledWith(null)
})
