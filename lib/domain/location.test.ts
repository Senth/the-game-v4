import { magvar } from "magvar"
import { describe, expect, it } from "vitest"
import {
	bearingDegrees,
	defaultPlaceRadius,
	distanceMeters,
	evaluateFix,
	fixTtlMs,
	guidanceBand,
	guidanceFor,
	guidanceWindowMs,
	maxFixAccuracy,
	newPlace,
	osmUrl,
	parseCoordinates,
	trendFrom,
	trendMinMeters,
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

describe("location guidance", () => {
	const at = Date.parse("2026-10-24T12:00:00Z")
	const fix = { lat: 55.5, lng: 13.2, accuracy: 10, at }
	const place = { id: "secret-place", lat: 55.51, lng: 13.2, radius: 40 }
	const location: Location = { guidance: "warmer", places: [place] }

	it("keeps trend tuning separate from the latest-fix lifetime", () => {
		expect({ guidanceWindowMs, trendMinMeters, fixTtlMs }).toEqual({
			guidanceWindowMs: 60_000,
			trendMinMeters: 25,
			fixTtlMs: 30_000,
		})
	})

	it.each([
		[39.999, "veryClose"],
		[40, "veryClose"],
		[40.001, "veryClose"],
		[119.999, "veryClose"],
		[120, "veryClose"],
		[120.001, "close"],
		[399.999, "close"],
		[400, "close"],
		[400.001, "far"],
	] as const)("bands distance %s with inclusive radius multiples", (distance, band) => {
		expect(guidanceBand(distance, 40)).toBe(band)
	})

	it.each([
		[{ lat: 1, lng: 0 }, 0],
		[{ lat: 0, lng: 1 }, 90],
		[{ lat: -1, lng: 0 }, 180],
		[{ lat: 0, lng: -1 }, 270],
	] as const)("computes initial true bearing to %j", (to, bearing) => {
		expect(bearingDegrees({ lat: 0, lng: 0 }, to)).toBeCloseTo(bearing, 8)
	})

	it("wraps initial bearings across north and the date line", () => {
		expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: 1, lng: -0.001 })).toBeGreaterThan(359)
		expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: 1, lng: 0.001 })).toBeLessThan(1)
		expect(bearingDegrees({ lat: 0, lng: 179 }, { lat: 0, lng: -179 })).toBeCloseTo(90)
	})

	it.each([
		[[], 100, undefined],
		[[124.999], 100, undefined],
		[[125], 100, "warmer"],
		[[125.001], 100, "warmer"],
		[[75.001], 100, undefined],
		[[75], 100, "colder"],
		[[74.999], 100, "colder"],
		[[100, 200], 125, "warmer"],
		[[100, 200], 175, "colder"],
		[[100, 200], 150, undefined],
	] as const)("compares history %j with distance %s", (previous, distance, trend) => {
		expect(trendFrom(previous, distance)).toBe(trend)
	})

	it("subtracts WMM2025 east declination at the fix and rounds magnetic bearings", () => {
		expect(magvar(fix.lat, fix.lng, 0, new Date(at))).toBeCloseTo(5.46, 1)
		expect(guidanceFor(location, fix, [])).toEqual({ band: "far", bearing: 355 })
		const elsewhere = { ...location, places: [{ ...place, lat: 55.5, lng: -60 }] }
		const bearing = bearingDegrees(fix, elsewhere.places[0] as typeof place)
		expect(guidanceFor(elsewhere, fix, [])?.bearing).toBe(
			(Math.round(bearing - magvar(fix.lat, fix.lng, 0, new Date(at))) + 360) % 360,
		)
	})

	it.each([
		[13.34, 359],
		[13.37, 0],
	])("normalizes rounded magnetic bearing for longitude %s", (lng, bearing) => {
		expect(guidanceFor({ ...location, places: [{ ...place, lat: 56.5, lng }] }, fix, [])?.bearing).toBe(bearing)
	})

	it.each([
		[20, undefined],
		[40, undefined],
		[40.001, "veryClose"],
		[120, "veryClose"],
		[120.001, "close"],
		[400, "close"],
		[400.001, "far"],
	] as const)("returns guidance only outside and hides very-close bearings at %s metres", (distance, band) => {
		const target = { ...place, lat: fix.lat + 0.001 }
		const measured = distanceMeters(fix, target)
		const located = { ...location, places: [{ ...target, radius: measured * (40 / distance) }] }
		const guidance = guidanceFor(located, fix, [measured + 25])
		if (!band) expect(guidance).toBeUndefined()
		else {
			expect(guidance).toEqual({ band, trend: "warmer", ...(band === "veryClose" ? {} : { bearing: 355 }) })
		}
	})

	it("whitelists output, leaves inputs unchanged and gives none quests no guidance", () => {
		const previous = [2000, 2100]
		const before = structuredClone({ location, fix, previous })
		expect(guidanceFor(location, fix, previous)).toEqual({ band: "far", bearing: 355, trend: "warmer" })
		expect(guidanceFor({ ...location, guidance: "none" }, fix, previous)).toBeUndefined()
		expect(guidanceFor({ ...location, guidance: "map" }, fix, previous)).toBeUndefined()
		expect(evaluateFix({ ...location, guidance: "map" }, fix, at)).toBe("outside")
		expect(guidanceFor({ ...location, places: [] }, fix, previous)).toBeUndefined()
		expect({ location, fix, previous }).toEqual(before)
	})
})
