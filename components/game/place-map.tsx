"use client"

import { useMemo, useState } from "react"
import LazyMap from "@/components/map/lazy-map"
import { boundsFor, circleRing } from "@/lib/domain/map"
import type { Place } from "@/lib/domain/schemas"

type MapPlace = Pick<Place, "lat" | "lng" | "radius">
type Position = { lat: number; lng: number; accuracy: number }

export function PlaceMap({ place, position, preview }: { place: MapPlace; position?: Position; preview: boolean }) {
	const [manual, setManual] = useState(false)
	const framing = useMemo(
		() =>
			manual
				? null
				: {
						bounds: boundsFor([
							...circleRing(place, place.radius),
							...(position ? ([[position.lng, position.lat]] as [number, number][]) : []),
						]),
					},
		[manual, place, position],
	)

	return (
		<div className="relative w-full">
			<LazyMap
				aspectRatio="4/3"
				circle={place}
				dot={preview ? null : (position ?? null)}
				framing={framing}
				interactive={!preview}
				onMoveEnd={(_, moved) => {
					if (moved) setManual(true)
				}}
			/>
			{manual && !preview && (
				<button
					type="button"
					onClick={() => setManual(false)}
					className="absolute top-2 right-2 z-10 min-h-11 rounded-md bg-z0/90 px-3 font-cond text-xs text-link hover:text-head focus-visible:outline-2 focus-visible:outline-link active:text-head"
				>
					Recenter
				</button>
			)}
		</div>
	)
}
