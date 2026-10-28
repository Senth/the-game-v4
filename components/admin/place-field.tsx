"use client"

import Link from "next/link"
import { useId, useMemo, useState } from "react"
import { inputClass, labelClass } from "@/components/auth-form"
import LazyMap from "@/components/map/lazy-map"
import { newPlace, parseCoordinates } from "@/lib/domain/location"
import { boundsFor, circleRing, roundCoordinate } from "@/lib/domain/map"
import type { Place, Quest, Season } from "@/lib/domain/schemas"
import { useAutosaveField } from "./autosave-provider"
import { useMyPosition } from "./use-my-position"

type Coordinates = Pick<Place, "lat" | "lng">

export function PlaceField({
	seasonId,
	arcId,
	questId,
	location,
	puzzle,
	seasonRadius,
	mapArea = null,
	solvedTeams,
}: {
	seasonId: string
	arcId: string
	questId: string
	location: Quest["location"]
	puzzle: Quest["puzzle"]
	seasonRadius: number
	mapArea?: Season["mapArea"]
	solvedTeams: number
}) {
	const field = useAutosaveField<Quest["location"]>({ arcId, questId, field: "location" }, location ?? null)
	const value = field.value ?? null
	const places = value?.places ?? []
	const circles = useMemo(() => places.map((place, index) => ({ ...place, number: index + 1 })), [places])
	const [coordinateDrafts, setCoordinateDrafts] = useState<Record<string, { value: string; lat: number; lng: number }>>(
		{},
	)
	const [radiusDrafts, setRadiusDrafts] = useState<Record<string, { value: number | ""; radius: number }>>({})
	const [pasteError, setPasteError] = useState<string | null>(null)
	const [dragPlace, setDragPlace] = useState<(Place & { number: number }) | null>(null)
	const [mapCenter, setMapCenter] = useState<Coordinates | null>(null)
	const id = useId()
	const locked = solvedTeams > 0
	const guidance = value?.guidance ?? "none"
	const framing = useMemo(
		() =>
			circles.length ? { bounds: boundsFor(circles.flatMap((circle) => circleRing(circle, circle.radius))) } : mapArea,
		[circles, mapArea],
	)
	const fallbackCenter = mapArea ? { lat: mapArea.lat, lng: mapArea.lng } : (places[0] ?? null)
	const currentCenter = mapCenter ?? fallbackCenter
	const error = locked
		? undefined
		: pasteError
			? "Paste latitude, longitude, like 55.5079, 13.2353."
			: field.failed
				? (field.error ?? "Not saved")
				: undefined
	const coordinatesClass = error
		? inputClass.replaceAll("border-z2", "border-warn").replaceAll("focus:border-accent", "focus:border-warn")
		: inputClass
	const radiusClass = (
		field.failed
			? inputClass.replaceAll("border-z2", "border-warn").replaceAll("focus:border-accent", "focus:border-warn")
			: inputClass
	).replace("w-full", "w-16")

	function locationAt(point: Coordinates, placeId?: string): NonNullable<Quest["location"]> {
		const rounded = { lat: roundCoordinate(point.lat), lng: roundCoordinate(point.lng) }
		const place = value?.places.find((item) => item.id === placeId)
		return value && placeId && place
			? { ...value, places: value.places.map((item) => (item.id === placeId ? { ...item, ...rounded } : item)) }
			: {
					guidance: value?.guidance ?? "none",
					places: [newPlace({ placeRadius: seasonRadius }, rounded.lat, rounded.lng)],
				}
	}

	function save(next: Quest["location"]) {
		if (locked || puzzle) return
		setDragPlace(null)
		setPasteError(null)
		setCoordinateDrafts({})
		setRadiusDrafts({})
		field.onChange(next)
		void field.onBlur()
	}

	function addPlace(point: Coordinates) {
		if (locked || puzzle || places.length >= 3) return
		const nextPlace = newPlace({ placeRadius: seasonRadius }, roundCoordinate(point.lat), roundCoordinate(point.lng))
		save({
			guidance: places.length ? "map" : guidance,
			places: [...places, nextPlace],
		})
	}

	function removePlace(placeId: string) {
		if (locked || !value) return
		const remaining = value.places.filter((place) => place.id !== placeId)
		save(remaining.length ? { ...value, places: remaining } : null)
	}

	function changeCoordinates(place: Place, input: string) {
		if (locked) return
		if (!input.trim()) {
			setPasteError(null)
			removePlace(place.id)
			return
		}
		try {
			const parsed = parseCoordinates(input)
			setCoordinateDrafts({})
			setPasteError(null)
			field.onChange(locationAt(parsed, place.id))
		} catch {
			setCoordinateDrafts({ [place.id]: { value: input, lat: place.lat, lng: place.lng } })
			setPasteError(place.id)
		}
	}

	const position = useMyPosition(!locked && !puzzle, (point) => {
		if (locked || puzzle) return
		const lastPlace = places.at(-1)
		save(locationAt(point, lastPlace?.id))
	})

	if (puzzle) {
		return (
			<div>
				<span className={labelClass}>Places</span>
				<p className="font-cond text-xs text-muted">Turn off puzzle mode to add a place.</p>
			</div>
		)
	}

	return (
		<div>
			<div className={labelClass}>
				Places <span className="ml-2 font-body normal-case tracking-normal">optional, up to 3</span>
			</div>
			<div className="mt-1 space-y-1.5">
				{places.map((place, index) => (
					<div key={place.id} className="flex min-w-0 items-center gap-1">
						<span
							aria-hidden="true"
							className="grid size-7 shrink-0 place-items-center rounded-full bg-z2 font-cond text-sm text-head"
						>
							{index + 1}
						</span>
						<input
							aria-label={`Place ${index + 1} coordinates`}
							aria-invalid={pasteError === place.id || (field.failed && !locked) ? true : undefined}
							aria-describedby={error ? `${id}-error` : `${id}-helper`}
							className={`${pasteError === place.id || (field.failed && !locked) ? coordinatesClass : inputClass} min-w-0 flex-1 text-sm${locked ? " text-muted" : ""}`}
							type="text"
							placeholder="Paste latitude, longitude"
							value={
								locked
									? `${place.lat}, ${place.lng}`
									: dragPlace?.id === place.id
										? `${dragPlace.lat}, ${dragPlace.lng}`
										: coordinateDrafts[place.id]?.lat === place.lat && coordinateDrafts[place.id]?.lng === place.lng
											? coordinateDrafts[place.id]?.value
											: `${place.lat}, ${place.lng}`
							}
							disabled={locked}
							onChange={(event) => changeCoordinates(place, event.target.value)}
							onFocus={field.onFocus}
							onBlur={() => void field.onBlur()}
						/>
						<input
							aria-label={`Place ${index + 1} radius`}
							aria-invalid={field.failed && !locked ? true : undefined}
							aria-describedby={error ? `${id}-error` : `${id}-helper`}
							className={`${radiusClass} shrink-0 px-2 text-sm${locked ? " text-muted" : ""}`}
							type="number"
							inputMode="numeric"
							min={5}
							max={500}
							step={1}
							value={
								locked || radiusDrafts[place.id]?.radius !== place.radius
									? place.radius
									: (radiusDrafts[place.id]?.value ?? place.radius)
							}
							disabled={locked}
							onChange={(event) => {
								if (!value || locked) return
								const next = event.target.valueAsNumber
								if (Number.isInteger(next) && next >= 5 && next <= 500) {
									const drafts = { ...radiusDrafts }
									delete drafts[place.id]
									setRadiusDrafts(drafts)
									field.onChange({
										...value,
										places: value.places.map((item) => (item.id === place.id ? { ...item, radius: next } : item)),
									})
								} else {
									setRadiusDrafts({
										...radiusDrafts,
										[place.id]: { value: Number.isNaN(next) ? "" : next, radius: place.radius },
									})
								}
							}}
							onFocus={field.onFocus}
							onBlur={() => void field.onBlur()}
						/>
						<span className="shrink-0 font-cond text-sm text-muted">m</span>
						<button
							aria-label={`Remove place ${index + 1}`}
							type="button"
							disabled={locked}
							onClick={() => removePlace(place.id)}
							className="grid size-11 shrink-0 place-items-center font-cond text-xl text-pace-3 hover:text-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:text-muted"
						>
							×
						</button>
					</div>
				))}
			</div>
			{error ? (
				<p id={`${id}-error`} role="alert" className="mt-1.5 font-cond text-xs text-warn">
					{error}
				</p>
			) : !places.length ? (
				<p id={`${id}-helper`} className="mt-1.5 font-cond text-xs text-muted">
					Empty means players type an answer.
				</p>
			) : null}
			{places.length > 0 && (
				<p id={`${id}-helper`} className="mt-1.5 font-cond text-xs text-muted">
					A different teammate inside every circle at once solves it.
				</p>
			)}
			{(places.length > 0 || mapArea) && (
				<div className="mt-3">
					<div className="relative">
						<LazyMap
							circles={circles.map((circle) =>
								dragPlace?.number === circle.number ? { ...dragPlace, number: circle.number } : circle,
							)}
							framing={framing}
							onMoveEnd={(area) => setMapCenter({ lat: area.lat, lng: area.lng })}
							edit={{
								enabled: !locked,
								onPreview: (number, next) => {
									if (locked) return
									const place = places[number - 1]
									if (place) {
										field.onFocus()
										setDragPlace({ ...next, id: place.id, number })
									}
								},
								onMove: (number, point) => {
									const place = places[number - 1]
									if (place) save(locationAt(point, place.id))
								},
								onResize: (number, radius) => {
									const place = places[number - 1]
									if (!value || !place || locked) return
									save({
										...value,
										places: value.places.map((item) =>
											item.id === place.id ? { ...item, radius: Math.min(500, Math.max(5, Math.round(radius))) } : item,
										),
									})
								},
								onCreate: (point) => addPlace(point),
							}}
						/>
						{places.length < 3 && !locked && (
							<p className="pointer-events-none absolute inset-x-0 top-4 text-center font-cond text-sm text-head">
								Tap the map to add a place
							</p>
						)}
					</div>
					{!locked && (
						<p className="mt-1.5 font-cond text-xs text-muted">
							Drag a pin to move its place. Drag the ring&apos;s handle to resize. Tap the map to add a place.
						</p>
					)}
				</div>
			)}
			<div className="flex flex-wrap items-center gap-x-3">
				<button
					type="button"
					disabled={locked || position.waiting}
					onClick={position.start}
					className="min-h-11 font-cond text-sm text-link hover:underline active:text-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:text-muted disabled:no-underline"
				>
					{position.waiting
						? `◎ Finding you…${position.accuracy === null ? "" : ` ±${position.accuracy} m`}`
						: "◎ Use my position"}
				</button>
				{(places.length > 0 || mapArea) && (
					<button
						type="button"
						disabled={locked || places.length >= 3}
						onClick={() => currentCenter && addPlace(currentCenter)}
						className="min-h-11 font-cond text-sm text-link hover:underline active:text-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:text-muted disabled:no-underline"
					>
						+ Add place
					</button>
				)}
				{!places.length && !mapArea && (
					<Link
						href={`/admin/seasons/${seasonId}/settings`}
						className="inline-flex min-h-11 items-center font-cond text-sm text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
					>
						Set a map area in Settings ›
					</Link>
				)}
				{position.waiting && (
					<button
						type="button"
						onClick={position.cancel}
						className="min-h-11 font-cond text-sm text-link hover:underline active:text-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
					>
						Cancel
					</button>
				)}
			</div>
			{position.waiting && (
				<span
					role="status"
					className="sr-only"
				>{`Finding you…${position.accuracy === null ? "" : ` ±${position.accuracy} m`}`}</span>
			)}
			{position.error && (
				<p role="alert" className="font-cond text-xs text-warn">
					{position.error}
				</p>
			)}
			{places.length > 0 && (
				<fieldset className="mt-3" disabled={locked} aria-describedby={`${id}-guidance-helper`}>
					<legend className={labelClass}>Guidance</legend>
					<div className="inline-flex rounded-md bg-z1 p-1">
						{(
							[
								["none", "None"],
								["warmer", "Warmer/colder"],
								["map", "Map"],
							] as const
						).map(([choice, label]) => (
							<button
								key={choice}
								type="button"
								aria-pressed={guidance === choice}
								disabled={locked || (places.length > 1 && choice !== "map")}
								onClick={() => {
									if (value && !locked && (places.length === 1 || choice === "map"))
										field.onChange({ ...value, guidance: choice })
								}}
								onFocus={field.onFocus}
								onBlur={() => void field.onBlur()}
								className={`min-h-11 rounded-md px-3 font-cond text-sm hover:text-head active:text-head focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60 ${guidance === choice ? "bg-accent text-head" : "text-muted"}`}
							>
								{label}
							</button>
						))}
					</div>
					<p id={`${id}-guidance-helper`} className={`mt-1.5 font-cond text-xs ${locked ? "text-head" : "text-muted"}`}>
						{locked
							? `Locked: ${solvedTeams} ${solvedTeams === 1 ? "team has" : "teams have"} solved this quest.`
							: places.length > 1
								? "Several places use Map. Players see every circle, their teammates' dots and which circles are held."
								: guidance === "map"
									? "Players see the circle, their own dot and their teammates' dots."
									: guidance === "warmer"
										? "Players see Far, Close or Very close, warmer or colder, and an arrow. Never the spot."
										: "Players get no hint of where the place is."}
					</p>
				</fieldset>
			)}
		</div>
	)
}
