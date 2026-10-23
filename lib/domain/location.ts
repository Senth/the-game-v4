import type { Location, Place, Season } from "./schemas"

export const defaultPlaceRadius = 40
export const maxFixAccuracy = 50
export const fixTtlMs = 30_000

type Coordinates = Pick<Place, "lat" | "lng">
export type Fix = Coordinates & { accuracy: number; at: number }

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
