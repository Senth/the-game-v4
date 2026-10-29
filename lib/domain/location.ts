import { magvar } from "magvar"
import type { Location, Place, Season } from "./schemas"

export const defaultPlaceRadius = 40
export const maxFixAccuracy = 50
export const fixTtlMs = 30_000
export const positionsPushMs = 5_000
export const fadeStartMs = 20_000
export const guidanceWindowMs = 60_000
export const trendMinMeters = 25

type Coordinates = Pick<Place, "lat" | "lng">
export type Fix = Coordinates & { accuracy: number; at: number }

export function fixAgeMs(fix: Fix, receivedAt: number, now: number): number {
	return Math.max(now - fix.at, now - receivedAt)
}

export function parseCoordinates(input: string): Coordinates {
	const match = input.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*°?(?:\s*,\s*|\s+)([+-]?\d+(?:\.\d+)?)\s*°?$/)
	const lat = Number(match?.[1])
	const lng = Number(match?.[2])
	if (!match || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
		throw new Error("Paste latitude, longitude, like 55.5079, 13.2353.")
	}
	return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) }
}

export function distanceMeters(from: Coordinates, to: Coordinates): number {
	const radians = Math.PI / 180
	const a =
		Math.sin(((to.lat - from.lat) * radians) / 2) ** 2 +
		Math.cos(from.lat * radians) * Math.cos(to.lat * radians) * Math.sin(((to.lng - from.lng) * radians) / 2) ** 2
	return 2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))))
}

export function placeCoverage(
	places: readonly Place[],
	fixes: ReadonlyMap<string, Fix>,
): { held: (string | null)[]; complete: boolean } {
	const candidates = places.map((place) =>
		[...fixes]
			.filter(([, fix]) => distanceMeters(place, fix) <= place.radius)
			.map(([phone]) => phone)
			.sort(),
	)
	const held: (string | null)[] = places.map(() => null)
	let best = [...held]
	let bestCount = 0
	let bestPriority = 0
	const used = new Set<string>()
	function assign(index: number, count: number, priority: number): void {
		if (index === places.length) {
			if (count > bestCount || (count === bestCount && priority > bestPriority)) {
				best = [...held]
				bestCount = count
				bestPriority = priority
			}
			return
		}
		for (const phone of candidates[index] ?? []) {
			if (used.has(phone)) continue
			held[index] = phone
			used.add(phone)
			assign(index + 1, count + 1, priority + 2 ** (places.length - index - 1))
			used.delete(phone)
		}
		held[index] = null
		assign(index + 1, count, priority)
	}
	assign(0, 0, 0)
	return { held: best, complete: bestCount === places.length }
}

export function bearingDegrees(from: Coordinates, to: Coordinates): number {
	const radians = Math.PI / 180
	const latitude = from.lat * radians
	const targetLatitude = to.lat * radians
	const longitudeDelta = (to.lng - from.lng) * radians
	const y = Math.sin(longitudeDelta) * Math.cos(targetLatitude)
	const x =
		Math.cos(latitude) * Math.sin(targetLatitude) -
		Math.sin(latitude) * Math.cos(targetLatitude) * Math.cos(longitudeDelta)
	return (Math.atan2(y, x) / radians + 360) % 360
}

export function guidanceBand(distance: number, radius: number): "far" | "close" | "veryClose" {
	return distance <= 3 * radius ? "veryClose" : distance <= 10 * radius ? "close" : "far"
}

export function trendFrom(previousDistances: readonly number[], distance: number): "warmer" | "colder" | undefined {
	if (!previousDistances.length) return undefined
	const change = previousDistances.reduce((sum, previous) => sum + previous, 0) / previousDistances.length - distance
	return change >= trendMinMeters ? "warmer" : change <= -trendMinMeters ? "colder" : undefined
}

export function guidanceFor(
	location: Location,
	fix: Fix,
	previousDistances: readonly number[],
): { band: ReturnType<typeof guidanceBand>; bearing?: number; trend?: "warmer" | "colder" } | undefined {
	const place = location.places[0]
	if (location.guidance !== "warmer" || !place) return undefined
	const distance = distanceMeters(fix, place)
	if (distance <= place.radius) return undefined
	const band = guidanceBand(distance, place.radius)
	const trend = trendFrom(previousDistances, distance)
	return {
		band,
		...(band === "veryClose"
			? {}
			: {
					bearing: (Math.round(bearingDegrees(fix, place) - magvar(fix.lat, fix.lng, 0, new Date(fix.at))) + 360) % 360,
				}),
		...(trend ? { trend } : {}),
	}
}

export function evaluateFix(location: Location, fix: Fix, now: number): "rough" | "stale" | "outside" | "inside" {
	if (!Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > maxFixAccuracy) return "rough"
	if (!Number.isFinite(fix.at) || Math.abs(now - fix.at) > fixTtlMs) return "stale"
	return location.places.some((place) => distanceMeters(place, fix) <= place.radius) ? "inside" : "outside"
}

export function osmUrl(lat: number, lng: number): string {
	return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`
}

export function newPlace(season: Pick<Season, "placeRadius">, lat: number, lng: number): Place {
	return { id: crypto.randomUUID(), lat, lng, radius: season.placeRadius ?? defaultPlaceRadius }
}
