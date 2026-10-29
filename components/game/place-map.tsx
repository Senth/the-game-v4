"use client"

import { useMemo, useState } from "react"
import LazyMap from "@/components/map/lazy-map"
import { boundsFor, circleRing } from "@/lib/domain/map"
import type { Place } from "@/lib/domain/schemas"
import type { Positions } from "@/lib/game/positions"

type MapPlace = Pick<Place, "lat" | "lng" | "radius">
type Position = { lat: number; lng: number; accuracy: number }

export function PlaceMap({
	places,
	position,
	positions,
	you,
	preview,
}: {
	places: MapPlace[]
	position?: Position
	positions?: Positions
	you?: string
	preview: boolean
}) {
	const [manual, setManual] = useState(false)
	const ownPosition = preview ? undefined : position
	const framing = useMemo(
		() =>
			manual
				? null
				: {
						bounds: boundsFor([
							...places.flatMap((place) => circleRing(place, place.radius)),
							...(ownPosition ? ([[ownPosition.lng, ownPosition.lat]] as [number, number][]) : []),
						]),
					},
		[manual, places, ownPosition],
	)

	return (
		<div className="relative w-full">
			<LazyMap
				aspectRatio="4/3"
				circles={places.map((place, index) => ({
					...place,
					number: index + 1,
					held: !preview && !!positions?.places[index]?.held,
				}))}
				dot={ownPosition ?? null}
				teammates={preview ? [] : positions?.phones.filter((phone) => phone.name !== you)}
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
