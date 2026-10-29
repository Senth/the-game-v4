import { Children, type ReactElement, type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { boundsFor, circleRing } from "@/lib/domain/map"
import type { Place } from "@/lib/domain/schemas"
import { PlaceMap } from "./place-map"

const hooks = vi.hoisted(() => ({ manual: false }))
vi.mock("react", async (importOriginal) => {
	const react = await importOriginal<typeof import("react")>()
	return {
		...react,
		useMemo: (factory: () => unknown) => factory(),
		useState: (initial: boolean) => [hooks.manual || initial, (next: boolean) => (hooks.manual = next)],
	}
})
vi.mock("@/components/map/lazy-map", () => ({ default: () => null }))

const place: Pick<Place, "lat" | "lng" | "radius"> = { lat: 55.5, lng: 13.2, radius: 40 }
type ChildElement = ReactElement<{ [key: string]: unknown; children?: ReactNode; onClick?: () => void }>

function view(props: Parameters<typeof PlaceMap>[0]) {
	const root = PlaceMap(props) as ReactElement<{ children: ReactNode }>
	return Children.toArray(root.props.children) as ChildElement[]
}

function mapProps(children: ChildElement[]) {
	return children[0]?.props as {
		aspectRatio: string
		circles: (Pick<Place, "lat" | "lng" | "radius"> & { number: number })[]
		teammates?: { name: string; ageMs: number }[]
		dot?: { lat: number; lng: number; accuracy: number }
		framing: unknown
		interactive: boolean
		onMoveEnd: (area: unknown, manual: boolean) => void
	}
}

describe("PlaceMap", () => {
	beforeEach(() => {
		hooks.manual = false
	})

	it("frames the circle before a fix and shares each own fix with the map", () => {
		let children = view({ places: [place], preview: false })
		let map = mapProps(children)
		expect(map.aspectRatio).toBe("4/3")
		expect(map.circles).toEqual([{ ...place, number: 1, held: false }])
		expect(map.dot).toBeNull()
		expect(map.framing).toBeTruthy()
		expect(map.interactive).toBe(true)
		expect(children.map((child) => child.props.children)).not.toContain("Recenter")

		children = view({ places: [place], position: { lat: 55.501, lng: 13.201, accuracy: 95 }, preview: false })
		map = mapProps(children)
		expect(map.dot).toEqual({ lat: 55.501, lng: 13.201, accuracy: 95 })
		expect(map.framing).toBeTruthy()
	})

	it("holds manual framing, updates a refetched circle, and resumes framing on Recenter", () => {
		let children = view({ places: [place], position: { lat: 55.501, lng: 13.201, accuracy: 12 }, preview: false })
		mapProps(children).onMoveEnd({}, true)

		const updatedPlace = { ...place, lat: 55.51, radius: 80 }
		children = view({ places: [updatedPlace], position: { lat: 55.502, lng: 13.202, accuracy: 20 }, preview: false })
		let map = mapProps(children)
		expect(map.circles).toEqual([{ ...updatedPlace, number: 1, held: false }])
		expect(map.framing).toBeNull()
		const recenter = children.find((child) => child.type === "button")
		expect(recenter?.props.children).toBe("Recenter")
		recenter?.props.onClick?.()

		children = view({ places: [updatedPlace], position: { lat: 55.502, lng: 13.202, accuracy: 20 }, preview: false })
		map = mapProps(children)
		expect(map.framing).toBeTruthy()
		expect(children.find((child) => child.type === "button")).toBeUndefined()
	})

	it("keeps previews inert and omits the own dot", () => {
		const children = view({ places: [place], position: { lat: 55.501, lng: 13.201, accuracy: 12 }, preview: true })
		const map = mapProps(children)
		expect(map.dot).toBeNull()
		expect(map.interactive).toBe(false)
		expect(map.framing).toBeTruthy()
	})

	it("numbers all circles, shows coverage, filters your phone, and never frames teammates", () => {
		const places = [place, { ...place, lat: 55.51 }, { ...place, lat: 55.52 }]
		const position = { lat: 55.53, lng: 13.21, accuracy: 10 }
		const positions = {
			places: [{ held: true }, { held: true }, { held: false }],
			phones: [
				{ name: "Keen Otter", lat: 80, lng: -100, ageMs: 21_000, place: 1 },
				{ name: "Bold Fox", lat: 55.51, lng: 13.2, ageMs: 100, place: 2 },
			],
		}
		const map = mapProps(view({ places, position, positions, you: "Bold Fox", preview: false }))
		expect(map.circles).toEqual(places.map((place, index) => ({ ...place, number: index + 1, held: index < 2 })))
		expect(map.teammates).toEqual([positions.phones[0]])
		expect(map.framing).toEqual({
			bounds: boundsFor([...places.flatMap((place) => circleRing(place, place.radius)), [position.lng, position.lat]]),
		})
		const preview = mapProps(view({ places, position, positions, preview: true }))
		expect(preview.teammates).toEqual([])
		expect(preview.circles).toEqual(places.map((place, index) => ({ ...place, number: index + 1, held: false })))
		expect(preview.framing).toEqual({ bounds: boundsFor(places.flatMap((place) => circleRing(place, place.radius))) })
	})
})
