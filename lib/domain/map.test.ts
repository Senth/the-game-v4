import { describe, expect, it } from "vitest"
import { bearingDegrees, distanceMeters } from "./location"
import {
	areaFromBounds,
	boundsFor,
	circleRing,
	edgePoint,
	radiusFromHandle,
	roundCoordinate,
	splitCircleRing,
} from "./map"

describe("map geometry", () => {
	const center = { lat: 55.5079, lng: 13.2353 }

	it.each([center, { lat: -33, lng: -179.999 }, { lat: 80, lng: 179.999 }])(
		"closes a 64-point geodesic circle at %j without changing its center",
		(point) => {
			const before = structuredClone(point)
			const ring = circleRing(point, 500)
			expect(ring).toHaveLength(65)
			expect(ring[0]).toEqual(ring.at(-1))
			for (const [index, [lng, lat]] of ring.entries()) {
				expect(distanceMeters(point, { lat, lng })).toBeCloseTo(500, 5)
				const previous = ring[index - 1]
				if (previous) expect(Math.abs(lng - previous[0])).toBeLessThan(1)
			}
			expect(point).toEqual(before)
		},
	)

	it("supports a requested circle resolution and an east-facing edge handle", () => {
		expect(circleRing(center, 40, 8)).toHaveLength(9)
		const edge = edgePoint(center, 40)
		expect(distanceMeters(center, edge)).toBeCloseTo(40, 6)
		expect(bearingDegrees(center, edge)).toBeCloseTo(90, 6)
	})

	it("splits circles into clockwise color arcs with gaps and a closed single-color ring", () => {
		const colors = ["red", "blue", "green"]
		const before = structuredClone({ center, colors })
		const arcs = splitCircleRing(center, 40, colors)
		expect(arcs).toHaveLength(colors.length)
		expect(arcs.map(({ color }) => color)).toEqual(colors)
		const bearings = arcs.map(({ coordinates }) =>
			coordinates.map(([lng, lat]) => (bearingDegrees(center, { lat, lng }) + 360) % 360),
		)
		expect(bearings[0]?.[0]).toBeCloseTo(5, 1)
		expect(bearings[0]?.at(-1)).toBeCloseTo(115, 1)
		expect(bearings[1]?.[0]).toBeCloseTo(125, 1)
		expect(bearings[1]?.at(-1)).toBeCloseTo(235, 1)
		expect(bearings[2]?.[0]).toBeCloseTo(245, 1)
		expect(bearings[2]?.at(-1)).toBeCloseTo(355, 1)
		for (const arc of bearings) {
			for (let index = 1; index < arc.length; index++) expect(arc[index]).toBeGreaterThan(arc[index - 1] as number)
		}
		const [single] = splitCircleRing(center, 40, ["red"])
		expect(single?.coordinates).toEqual(circleRing(center, 40))
		expect(single?.coordinates[0]).toEqual(single?.coordinates.at(-1))
		expect({ center, colors }).toEqual(before)
	})

	it.each([
		[0, 5],
		[4.49, 5],
		[5, 5],
		[40.49, 40],
		[40.51, 41],
		[500, 500],
		[500.51, 500],
		[1000, 500],
	])("rounds and clamps handle distance %s to %s metres", (distance, expected) => {
		expect(radiusFromHandle(center, edgePoint(center, distance))).toBe(expected)
	})

	it.each([
		[55.5079126, 55.507913],
		[-13.2353126, -13.235313],
		[90, 90],
		[0, 0],
	])("rounds coordinate %s to six decimals", (value, expected) => {
		expect(roundCoordinate(value)).toBe(expected)
	})

	it("bounds ordinary points and single points without mutating them", () => {
		const points: [number, number][] = [
			[13, 55],
			[12, 56],
			[14, 54],
		]
		const before = structuredClone(points)
		expect(boundsFor(points)).toEqual([
			[12, 54],
			[14, 56],
		])
		expect(boundsFor([[13, 55]])).toEqual([
			[13, 55],
			[13, 55],
		])
		expect(points).toEqual(before)
	})

	it("uses the smallest longitude span across the antimeridian regardless of point order", () => {
		for (const points of [
			[
				[179, 10],
				[-179, -10],
				[178, 0],
			],
			[
				[-179, -10],
				[178, 0],
				[179, 10],
			],
		] as [number, number][][]) {
			expect(boundsFor(points)).toEqual([
				[178, -10],
				[181, 10],
			])
		}
		const bounds = boundsFor(circleRing({ lat: 55, lng: 179.999 }, 500))
		expect(bounds[1][0] - bounds[0][0]).toBeLessThan(0.1)
	})

	it("converts Nominatim south, north, west, east strings to map bounds", () => {
		const bbox: [string, string, string, string] = ["55", "56", "12", "14"]
		expect(areaFromBounds(bbox)).toEqual([
			[12, 55],
			[14, 56],
		])
		expect(bbox).toEqual(["55", "56", "12", "14"])
		expect(areaFromBounds(["-10", "10", "179", "-179"])).toEqual([
			[179, -10],
			[181, 10],
		])
	})
})
