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

const place = { id: "place-1", lat: 55.50682, lng: 13.23289, radius: 75 }
const secondPlace = { id: "place-2", lat: 55.51, lng: 13.24, radius: 80 }
const thirdPlace = { id: "place-3", lat: 55.52, lng: 13.25, radius: 90 }
const field = {
	value: null as Quest["location"],
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
type InputProps = Pick<
	ComponentProps<"input">,
	"aria-label" | "aria-invalid" | "className" | "disabled" | "onChange" | "value"
>
type ButtonProps = Pick<
	ComponentProps<"button">,
	"aria-label" | "aria-pressed" | "className" | "disabled" | "onClick" | "children"
>

function descendants<T>(node: ReactNode, type: string): ReactElement<T>[] {
	return Children.toArray(node).flatMap((child) => {
		if (!isValidElement<{ children?: ReactNode }>(child)) return []
		return child.type === type ? [child as ReactElement<T>] : descendants<T>(child.props.children, type)
	})
}

function inputs(node: ReactNode): ReactElement<InputProps>[] {
	return descendants<InputProps>(node, "input")
}

function buttons(node: ReactNode): ReactElement<ButtonProps>[] {
	return descendants<ButtonProps>(node, "button")
}

function change(input: ReactElement<InputProps>, value: string) {
	input.props.onChange?.({ target: { value, valueAsNumber: value === "" ? Number.NaN : Number(value) } } as never)
}

function component(props: Parameters<typeof PlaceField>[0]) {
	hooks.cursor = 0
	return PlaceField(props)
}

function render(props: Parameters<typeof PlaceField>[0]) {
	hooks.cursor = 0
	return renderToStaticMarkup(<PlaceField {...props} />)
}

function mapProps(node: ReactNode): MapViewProps | undefined {
	for (const child of Children.toArray(node)) {
		if (!isValidElement<{ children?: ReactNode }>(child)) continue
		if (child.type === LazyMap) return child.props as MapViewProps
		const found = mapProps(child.props.children)
		if (found) return found
	}
}

function selectLocation(value: Quest["location"]) {
	field.value = value
	return { ...props, location: value }
}

beforeEach(() => {
	vi.clearAllMocks()
	field.onChange.mockReset()
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

it("shows optional Places, position action and settings link without rows, add button or map", () => {
	const html = render(props)
	expect(useAutosaveField).toHaveBeenCalledWith({ arcId: "arc", questId: "quest", field: "location" }, null)
	expect(html).toContain("Places")
	expect(html).toContain("optional, up to 3")
	expect(html).toContain("Empty means players type an answer.")
	expect(html).toContain("◎ Use my position")
	expect(html).toContain('href="/admin/seasons/season/settings"')
	expect(html).not.toContain("+ Add place")
	expect(html).not.toContain("Editor map")
})

it("renders one numbered row, season-radius field and numbered map pin with guidance after map", () => {
	const value = { guidance: "map" as const, places: [place] }
	const tree = component(selectLocation(value))
	const html = render(selectLocation(value))
	const rows = inputs(tree)
	expect(rows.map((input) => input.props["aria-label"])).toEqual(["Place 1 coordinates", "Place 1 radius"])
	expect(rows[0]?.props.value).toBe("55.50682, 13.23289")
	expect(rows[1]?.props.value).toBe(75)
	expect(rows[0]?.props.className).toContain("min-w-0 flex-1")
	expect(rows[1]?.props.className).toContain("w-16")
	expect(html).toContain("A different teammate inside every circle at once solves it.")
	expect(html).toContain('id="place-helper"')
	expect(html).toContain(
		"Drag a pin to move its place. Drag the ring&#x27;s handle to resize. Tap the map to add a place.",
	)
	expect(html).toContain("Players see the circle, their own dot and their teammates&#x27; dots.")
	expect(html.indexOf("Place 1 coordinates")).toBeLessThan(html.indexOf("Editor map"))
	expect(html.indexOf("Editor map")).toBeLessThan(html.indexOf("Guidance"))
	expect(mapProps(tree)?.circles).toEqual([{ ...place, number: 1 }])
	expect(mapProps(tree)?.framing).toEqual({ bounds: boundsFor(circleRing(place, place.radius)) })
})

it("adds places from the map centre or tapped point with season radius and switches to Map at two", () => {
	const mapArea = { lat: 55, lng: 13, zoom: 12 }
	const emptyProps = { ...props, mapArea, seasonRadius: 125 }
	const empty = component(emptyProps)
	mapProps(empty)?.onMoveEnd?.({ lat: 56, lng: 14, zoom: 13 }, false)
	const remounted = component(emptyProps)
	const add = buttons(remounted).find((button) => button.props.children === "+ Add place")
	add?.props.onClick?.({} as never)
	expect(field.onChange).toHaveBeenCalledExactlyOnceWith({
		guidance: "none",
		places: [expect.objectContaining({ lat: 56, lng: 14, radius: 125 })],
	})
	expect(field.onBlur).toHaveBeenCalledOnce()

	field.onChange.mockClear()
	const value = { guidance: "warmer" as const, places: [place] }
	const tree = component(selectLocation(value))
	mapProps(tree)?.edit?.onCreate({ lat: 55.50790001, lng: 13.23530001 })
	expect(field.onChange).toHaveBeenCalledExactlyOnceWith({
		guidance: "map",
		places: [place, expect.objectContaining({ lat: 55.5079, lng: 13.2353, radius: 40 })],
	})
})

it("caps places at three, disables Add and ignores another map tap", () => {
	const value = { guidance: "map" as const, places: [place, secondPlace, thirdPlace] }
	const tree = component(selectLocation(value))
	const add = buttons(tree).find((button) => button.props.children === "+ Add place")
	expect(add?.props.disabled).toBe(true)
	mapProps(tree)?.edit?.onCreate({ lat: 1, lng: 2 })
	expect(field.onChange).not.toHaveBeenCalled()
	expect(mapProps(tree)?.circles?.map(({ number }) => number)).toEqual([1, 2, 3])
})

it("renumbers remaining places on remove and clearing a row removes that place", () => {
	const value = { guidance: "map" as const, places: [place, secondPlace, thirdPlace] }
	const tree = component(selectLocation(value))
	buttons(tree)
		.find((button) => button.props["aria-label"] === "Remove place 2")
		?.props.onClick?.({} as never)
	expect(field.onChange).toHaveBeenCalledExactlyOnceWith({ guidance: "map", places: [place, thirdPlace] })
	expect(field.onBlur).toHaveBeenCalledOnce()
	const remainingRows = inputs(component({ ...props, location: { guidance: "map", places: [place, thirdPlace] } }))
	expect(remainingRows[0]?.props["aria-label"]).toBe("Place 1 coordinates")
	expect(remainingRows[2]?.props["aria-label"]).toBe("Place 2 coordinates")

	field.onChange.mockClear()
	const coordinates = inputs(component(selectLocation(value)))[0]
	if (!coordinates) throw new Error("Place coordinates input missing")
	change(coordinates, "")
	expect(field.onChange).toHaveBeenCalledExactlyOnceWith({ guidance: "map", places: [secondPlace, thirdPlace] })
	field.onChange.mockClear()
	const onlyPlace = inputs(component(selectLocation({ guidance: "none", places: [place] })))[0]
	if (!onlyPlace) throw new Error("Place coordinates input missing")
	change(onlyPlace, "")
	expect(field.onChange).toHaveBeenCalledExactlyOnceWith(null)
})

it("pastes valid coordinates per row and shows invalid paste without saving it", () => {
	const value = { guidance: "map" as const, places: [place, secondPlace] }
	const rows = inputs(component(selectLocation(value)))
	change(rows[2] as ReactElement<InputProps>, "55.5079, 13.2353")
	expect(field.onChange).toHaveBeenCalledExactlyOnceWith({
		guidance: "map",
		places: [place, { ...secondPlace, lat: 55.5079, lng: 13.2353 }],
	})

	field.onChange.mockClear()
	const coordinates = inputs(component(selectLocation(value)))[0]
	if (!coordinates) throw new Error("Place coordinates input missing")
	change(coordinates, "55.5079,")
	expect(field.onChange).not.toHaveBeenCalled()
	expect(render(selectLocation(value))).toContain("Paste latitude, longitude, like 55.5079, 13.2353.")
	expect(render(selectLocation(value))).toContain("border-warn")
})

it("edits radius by row and locks every place control after a solve", () => {
	const value = { guidance: "map" as const, places: [place, secondPlace] }
	const rows = inputs(component(selectLocation(value)))
	change(rows[3] as ReactElement<InputProps>, "90")
	expect(field.onChange).toHaveBeenCalledExactlyOnceWith({
		guidance: "map",
		places: [place, { ...secondPlace, radius: 90 }],
	})

	field.onChange.mockClear()
	const locked = { ...props, location: value, solvedTeams: 1 }
	const tree = component(locked)
	const html = render(locked)
	expect(inputs(tree).every((input) => input.props.disabled)).toBe(true)
	expect(
		buttons(tree)
			.filter((button) => button.props["aria-label"]?.startsWith("Remove place"))
			.every((button) => button.props.disabled),
	).toBe(true)
	expect(buttons(tree).find((button) => button.props.children === "+ Add place")?.props.disabled).toBe(true)
	expect(buttons(tree).find((button) => button.props.children === "◎ Use my position")?.props.disabled).toBe(true)
	expect(html).toContain("Locked: 1 team has solved this quest.")
	expect(mapProps(tree)?.edit?.enabled).toBe(false)
	expect(vi.mocked(useMyPosition)).toHaveBeenLastCalledWith(false, expect.any(Function))
	mapProps(tree)?.edit?.onCreate({ lat: 1, lng: 2 })
	mapProps(tree)?.edit?.onMove(1, { lat: 1, lng: 2 })
	mapProps(tree)?.edit?.onResize(1, 100)
	expect(field.onChange).not.toHaveBeenCalled()
})

it("disables None and Warmer/colder for several places and shows multi-place guidance", () => {
	const value = { guidance: "map" as const, places: [place, secondPlace] }
	const tree = component(selectLocation(value))
	const choices = buttons(tree).filter((button) => button.props["aria-pressed"] !== undefined)
	expect(choices.map((button) => button.props.disabled)).toEqual([true, true, false])
	expect(render(selectLocation(value))).toContain(
		"Several places use Map. Players see every circle, their teammates&#x27; dots and which circles are held.",
	)
})

it("saves each dragged place once on release and frames every circle", () => {
	const value = { guidance: "map" as const, places: [place, secondPlace] }
	const map = mapProps(component(selectLocation(value)))
	expect(map?.framing).toEqual({
		bounds: boundsFor([...circleRing(place, place.radius), ...circleRing(secondPlace, secondPlace.radius)]),
	})
	map?.edit?.onPreview?.(2, { ...secondPlace, number: 2, lat: 55.5079, lng: 13.2353 })
	expect(field.onChange).not.toHaveBeenCalled()
	map?.edit?.onMove(2, { lat: 55.50790001, lng: 13.23530001 })
	expect(field.onChange).toHaveBeenCalledExactlyOnceWith({
		guidance: "map",
		places: [place, { ...secondPlace, lat: 55.5079, lng: 13.2353 }],
	})
	expect(field.onBlur).toHaveBeenCalledOnce()

	field.onChange.mockClear()
	map?.edit?.onResize(1, 74.6)
	expect(field.onChange).toHaveBeenCalledExactlyOnceWith({
		guidance: "map",
		places: [{ ...place, radius: 75 }, secondPlace],
	})
})

it("uses my position to create the first place or move the last without changing its radius", () => {
	component({ ...props, seasonRadius: 125 })
	vi.mocked(useMyPosition).mock.lastCall?.[1]({ lat: 55.50790001, lng: 13.23530001 })
	expect(field.onChange).toHaveBeenCalledExactlyOnceWith({
		guidance: "none",
		places: [expect.objectContaining({ lat: 55.5079, lng: 13.2353, radius: 125 })],
	})
	expect(field.onBlur).toHaveBeenCalledOnce()

	field.onChange.mockClear()
	const single = { guidance: "warmer" as const, places: [place] }
	component(selectLocation(single))
	vi.mocked(useMyPosition).mock.lastCall?.[1]({ lat: 55.1, lng: 13.1 })
	expect(field.onChange).toHaveBeenCalledExactlyOnceWith({
		guidance: "warmer",
		places: [{ ...place, lat: 55.1, lng: 13.1 }],
	})

	field.onChange.mockClear()
	const value = { guidance: "map" as const, places: [place, secondPlace] }
	component(selectLocation(value))
	vi.mocked(useMyPosition).mock.lastCall?.[1]({ lat: 55.1, lng: 13.1 })
	expect(field.onChange).toHaveBeenCalledExactlyOnceWith({
		guidance: "map",
		places: [place, { ...secondPlace, lat: 55.1, lng: 13.1 }],
	})
})

it("keeps map controls within a flexible row at phone width", () => {
	const tree = component(selectLocation({ guidance: "map", places: [place, secondPlace, thirdPlace] }))
	const coordinateFields = inputs(tree).filter((input) => String(input.props["aria-label"]).includes("coordinates"))
	const radiusFields = inputs(tree).filter((input) => String(input.props["aria-label"]).includes("radius"))
	const removeButtons = buttons(tree).filter((button) => button.props["aria-label"]?.startsWith("Remove place"))
	expect(coordinateFields.every((input) => input.props.className?.includes("min-w-0 flex-1"))).toBe(true)
	expect(radiusFields.every((input) => input.props.className?.includes("w-16"))).toBe(true)
	expect(removeButtons.every((button) => button.props.className?.includes("size-11 shrink-0"))).toBe(true)
})

it("shows Use my position wait, cancel and warning feedback", () => {
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

it("blocks Places while puzzle mode is on", () => {
	const html = render({ ...props, puzzle: { rows: 4, cols: 4, showFull: false } })
	expect(html).toContain("Turn off puzzle mode to add a place.")
	expect(inputs(component({ ...props, puzzle: { rows: 4, cols: 4, showFull: false } }))).toHaveLength(0)
})
