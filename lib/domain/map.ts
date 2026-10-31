import { distanceMeters } from "./location"
import type { Place } from "./schemas"

type Coordinates = Pick<Place, "lat" | "lng">
type Point = [number, number]
type Bounds = [Point, Point]

export const roundCoordinate = (value: number): number => Number(value.toFixed(6))

function destination(center: Coordinates, radius: number, bearing: number): Coordinates {
	const radians = Math.PI / 180
	const latitude = center.lat * radians
	const angle = radius / 6371000
	const heading = bearing * radians
	const lat = Math.asin(Math.sin(latitude) * Math.cos(angle) + Math.cos(latitude) * Math.sin(angle) * Math.cos(heading))
	const lng =
		center.lng +
		Math.atan2(
			Math.sin(heading) * Math.sin(angle) * Math.cos(latitude),
			Math.cos(angle) - Math.sin(latitude) * Math.sin(lat),
		) /
			radians
	return { lat: lat / radians, lng }
}

export function circleRing(center: Coordinates, radius: number, points = 64): Point[] {
	return Array.from({ length: points + 1 }, (_, index): Point => {
		const { lat, lng } = destination(center, radius, ((index % points) * 360) / points)
		return [lng, lat]
	})
}

export function splitCircleRing(
	center: Coordinates,
	radius: number,
	colors: string[],
): { color: string; coordinates: Point[] }[] {
	if (colors.length === 1) return [{ color: colors[0] as string, coordinates: circleRing(center, radius) }]
	const step = 360 / colors.length
	const gap = Math.min(5, step / 4)
	const arcLength = step - gap * 2
	return colors.map((color, index) => {
		const start = index * step + gap
		const count = Math.ceil(arcLength / (360 / 64))
		return {
			color,
			coordinates: Array.from({ length: count + 1 }, (_, point): Point => {
				const { lat, lng } = destination(center, radius, start + (arcLength * point) / count)
				return [lng, lat]
			}),
		}
	})
}

export function edgePoint(center: Coordinates, radius: number): Coordinates {
	return destination(center, radius, 90)
}

export function radiusFromHandle(center: Coordinates, point: Coordinates): number {
	return Math.min(500, Math.max(5, Math.round(distanceMeters(center, point))))
}

export function boundsFor(points: readonly Point[]): Bounds {
	const longitudes = points.map(([lng]) => ((((lng + 180) % 360) + 360) % 360) - 180).sort((a, b) => a - b)
	let west = longitudes[0]
	let east = longitudes.at(-1)
	if (west === undefined || east === undefined) throw new RangeError("Map bounds need at least one point")
	let largestGap = west + 360 - east
	for (let index = 1; index < longitudes.length; index++) {
		const previous = longitudes[index - 1] as number
		const current = longitudes[index] as number
		if (current - previous > largestGap) {
			largestGap = current - previous
			west = current
			east = previous
		}
	}
	const latitudes = points.map(([, lat]) => lat)
	return [
		[west, Math.min(...latitudes)],
		[east < west ? east + 360 : east, Math.max(...latitudes)],
	]
}

export function areaFromBounds([south, north, west, east]: readonly [string, string, string, string]): Bounds {
	const left = Number(west)
	const right = Number(east)
	return [
		[left, Number(south)],
		[right < left ? right + 360 : right, Number(north)],
	]
}
