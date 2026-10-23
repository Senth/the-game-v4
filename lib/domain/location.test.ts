import { describe, expect, it } from "vitest"
import {
	defaultPlaceRadius,
	distanceMeters,
	evaluateFix,
	fixTtlMs,
	maxFixAccuracy,
	newPlace,
	osmUrl,
	parseCoordinates,
} from "./location"
import type { Location } from "./schemas"

describe("parseCoordinates", () => {
	it.each(["55.5079, 13.2353", "55.5079 13.2353", " 55.5079° , 13.2353° ", "55.5079,13.2353"])(
		"parses decimal coordinates %s",
		(input) => {
			expect(parseCoordinates(input)).toEqual({ lat: 55.5079, lng: 13.2353 })
		},
	)

	it.each([
		["-90, -180", { lat: -90, lng: -180 }],
		["+90°, +180°", { lat: 90, lng: 180 }],
		["55.5079126, -13.2353126", { lat: 55.507913, lng: -13.235313 }],
	])("accepts bounds and rounds %s to six decimals", (input, expected) => {
		expect(parseCoordinates(input)).toEqual(expected)
	})

	it.each([
		"",
		"55.5",
		"55.5,",
		"55.5,,13.2",
		"55.5,13.2,1",
		"55.5N,13.2E",
		"1e1,2",
		"NaN,0",
		"Infinity,0",
		"90.0000001,0",
		"-90.01,0",
		"0,180.0000001",
		"0,-180.01",
		"55°30,13°14",
		"https://maps.example/55.5,13.2",
		"55.5;13.2",
	])("rejects bad paste %j with the prescribed error", (input) => {
		expect(() => parseCoordinates(input)).toThrow("Paste latitude, longitude, like 55.5079, 13.2353.")
	})
})

describe("distanceMeters", () => {
	it("uses great-circle distance, including across the date line and antipodes", () => {
		expect(distanceMeters({ lat: 55.5, lng: 13.2 }, { lat: 55.5, lng: 13.2 })).toBe(0)
		expect(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111194.93, 2)
		expect(distanceMeters({ lat: 0, lng: 179 }, { lat: 0, lng: -179 })).toBeCloseTo(222389.85, 2)
		expect(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(Math.PI * 6371000)
	})
})

describe("evaluateFix", () => {
	const now = Date.parse("2026-10-23T18:00:00Z")
	const place = { id: "place-secret", lat: 55.5079, lng: 13.2353, radius: 40 }
	const location: Location = { guidance: "none", places: [place] }
	const fix = { lat: place.lat, lng: place.lng, accuracy: 50, at: now }

	it("keeps the agreed constants", () => {
		expect({ defaultPlaceRadius, maxFixAccuracy, fixTtlMs }).toEqual({
			defaultPlaceRadius: 40,
			maxFixAccuracy: 50,
			fixTtlMs: 30_000,
		})
	})

	it.each([
		[50, "inside"],
		[50.01, "rough"],
	] as const)("evaluates accuracy %s as %s", (accuracy, status) => {
		expect(evaluateFix(location, { ...fix, accuracy }, now)).toBe(status)
	})

	it.each([
		[-30_001, "stale"],
		[-30_000, "inside"],
		[30_000, "inside"],
		[30_001, "stale"],
	] as const)("evaluates timestamp offset %s as %s", (offset, status) => {
		expect(evaluateFix(location, { ...fix, at: now + offset }, now)).toBe(status)
	})

	it("includes the exact radius boundary without widening it by accuracy", () => {
		const edge = { ...fix, lat: place.lat + 0.0001 }
		const radius = distanceMeters(place, edge)
		expect(evaluateFix({ ...location, places: [{ ...place, radius }] }, edge, now)).toBe("inside")
		expect(evaluateFix({ ...location, places: [{ ...place, radius: radius - 0.000001 }] }, edge, now)).toBe("outside")
	})

	it("returns outside without a place and leaves location and fix unchanged", () => {
		const before = structuredClone({ location, fix })
		expect(evaluateFix({ guidance: "none", places: [] }, fix, now)).toBe("outside")
		expect(evaluateFix(location, { ...fix, lat: 0 }, now)).toBe("outside")
		expect(evaluateFix(location, fix, now)).toBe("inside")
		expect({ location, fix }).toEqual(before)
	})
})

describe("newPlace and osmUrl", () => {
	it("copies season radius or its legacy default, with a fresh stable id and unchanged season", () => {
		const season = { placeRadius: 65 }
		const place = newPlace(season, 55.5079, 13.2353)
		expect(place).toEqual({ id: expect.any(String), lat: 55.5079, lng: 13.2353, radius: 65 })
		expect(place.id).toMatch(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/)
		expect(newPlace({}, 0, 0).radius).toBe(40)
		expect(newPlace(season, place.lat, place.lng).id).not.toBe(place.id)
		season.placeRadius = 100
		expect(place.radius).toBe(65)
		expect(season).toEqual({ placeRadius: 100 })
	})

	it("builds the prescribed OpenStreetMap link", () => {
		expect(osmUrl(55.5079, -13.2353)).toBe(
			"https://www.openstreetmap.org/?mlat=55.5079&mlon=-13.2353#map=18/55.5079/-13.2353",
		)
	})
})
