import { Children, type ComponentProps, isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import type { Quest } from "@/lib/domain/schemas"
import { useAutosaveField } from "./autosave-provider"
import { PlaceField } from "./place-field"

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
}))
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
const props = { arcId: "arc", questId: "quest", location: null, puzzle: null, seasonRadius: 40, solvedTeams: 0 }
type InputProps = Pick<ComponentProps<"input">, "aria-label" | "disabled" | "onChange" | "value"> & {
	children?: ReactNode
}

function inputs(node: ReactNode): ReactElement<InputProps>[] {
	return Children.toArray(node).flatMap((child) => {
		if (!isValidElement<InputProps>(child)) return []
		return child.type === "input" ? [child] : inputs(child.props.children)
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

it("shows saved coordinates, radius guidance and map link", () => {
	field.value = { guidance: "none", places: [place] }
	const html = render({ ...props, location: field.value })
	expect(html).toContain('value="55.50682, 13.23289"')
	expect(html).toContain('value="75"')
	expect(html).toContain("Getting within the radius solves it. Players never see the coordinates.")
	expect(html).toContain(
		'href="https://www.openstreetmap.org/?mlat=55.50682&amp;mlon=13.23289#map=18/55.50682/13.23289"',
	)
	expect(html).toContain("Check on map ›")
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
	expect(
		inputs(component({ ...props, location: field.value, solvedTeams: 2 })).every((input) => input.props.disabled),
	).toBe(true)
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
