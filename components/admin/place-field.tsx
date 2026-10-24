"use client"

import Link from "next/link"
import { useEffect, useId, useMemo, useState } from "react"
import { inputClass, labelClass } from "@/components/auth-form"
import LazyMap from "@/components/map/lazy-map"
import { newPlace, parseCoordinates } from "@/lib/domain/location"
import { boundsFor, circleRing, roundCoordinate } from "@/lib/domain/map"
import type { Place, Quest, Season } from "@/lib/domain/schemas"
import { useAutosaveField } from "./autosave-provider"
import { useMyPosition } from "./use-my-position"

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
	const place = value?.places[0]
	const [radius, setRadius] = useState<number | "">(place?.radius ?? seasonRadius)
	const guidance = value?.guidance ?? "none"
	const savedCoordinates = place ? `${place.lat}, ${place.lng}` : ""
	const [coordinates, setCoordinates] = useState(() => (place ? `${place.lat}, ${place.lng}` : ""))
	const [pasteError, setPasteError] = useState(false)
	const [dragPlace, setDragPlace] = useState<Pick<Place, "lat" | "lng" | "radius"> | null>(null)
	const id = useId()
	const locked = solvedTeams > 0
	const position = useMyPosition(!locked && !puzzle, (point) => {
		if (!locked && !puzzle) commit(locationAt(point))
	})
	const framing = useMemo(
		() => (place ? { bounds: boundsFor(circleRing(place, place.radius)) } : mapArea),
		[place, mapArea],
	)
	const error = locked
		? undefined
		: pasteError
			? "Paste latitude, longitude, like 55.5079, 13.2353."
			: field.failed
				? field.error
				: undefined
	const helper = locked
		? `Locked: ${solvedTeams} ${solvedTeams === 1 ? "team has" : "teams have"} found this place.`
		: place
			? guidance === "map"
				? "Getting within the radius solves it. Players see this circle."
				: "Getting within the radius solves it. Players never see the coordinates."
			: "Empty means players type an answer."
	const coordinatesClass = error
		? inputClass.replaceAll("border-z2", "border-warn").replaceAll("focus:border-accent", "focus:border-warn")
		: inputClass
	const radiusClass = field.failed
		? inputClass.replaceAll("border-z2", "border-warn").replaceAll("focus:border-accent", "focus:border-warn")
		: inputClass

	useEffect(() => {
		if (!pasteError) setCoordinates(savedCoordinates)
	}, [savedCoordinates, pasteError])
	useEffect(() => {
		setRadius(place?.radius ?? seasonRadius)
	}, [place?.radius, seasonRadius])

	function locationAt(point: Pick<Place, "lat" | "lng">): NonNullable<Quest["location"]> {
		const rounded = { lat: roundCoordinate(point.lat), lng: roundCoordinate(point.lng) }
		return value && place
			? { ...value, places: [{ ...place, ...rounded }] }
			: { guidance: "none", places: [newPlace({ placeRadius: seasonRadius }, rounded.lat, rounded.lng)] }
	}

	function commit(next: NonNullable<Quest["location"]>) {
		if (locked || puzzle) return
		setDragPlace(null)
		setPasteError(false)
		setCoordinates(`${next.places[0]?.lat}, ${next.places[0]?.lng}`)
		field.onChange(next)
		void field.onBlur()
	}

	function changeCoordinates(input: string) {
		if (locked) return
		setCoordinates(input)
		if (!input.trim()) {
			setPasteError(false)
			field.onChange(null)
			return
		}
		try {
			const parsed = parseCoordinates(input)
			setPasteError(false)
			field.onChange(locationAt(parsed))
		} catch {
			setPasteError(true)
		}
	}

	if (puzzle) {
		return (
			<div>
				<span className={labelClass}>Place</span>
				<p className="font-cond text-xs text-muted">Turn off puzzle mode to add a place.</p>
			</div>
		)
	}

	return (
		<div>
			<label htmlFor={`${id}-coordinates`} className={labelClass}>
				Place <span className="ml-2 font-body normal-case tracking-normal">optional</span>
			</label>
			<div className="flex min-w-0 items-center gap-2">
				<input
					id={`${id}-coordinates`}
					aria-label="Place coordinates"
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? `${id}-error` : `${id}-helper`}
					className={`${coordinatesClass} min-w-0 flex-1 text-sm${locked ? " text-muted" : ""}`}
					type="text"
					placeholder="Paste latitude, longitude"
					value={dragPlace && !locked ? `${dragPlace.lat}, ${dragPlace.lng}` : coordinates}
					disabled={locked}
					onChange={(event) => changeCoordinates(event.target.value)}
					onFocus={field.onFocus}
					onBlur={() => void field.onBlur()}
				/>
				<input
					aria-label="Place radius"
					aria-invalid={field.failed ? true : undefined}
					aria-describedby={error ? `${id}-error` : `${id}-helper`}
					className={`${radiusClass} w-16 px-2 text-sm${locked || !place ? " text-muted" : ""}`}
					type="number"
					inputMode="numeric"
					min={5}
					max={500}
					step={1}
					value={(locked ? undefined : dragPlace?.radius) ?? radius}
					disabled={locked || !place}
					onChange={(event) => {
						if (!place || !value || locked) return
						const next = event.target.valueAsNumber
						setRadius(Number.isNaN(next) ? "" : next)
						if (Number.isInteger(next) && next >= 5 && next <= 500)
							field.onChange({ ...value, places: [{ ...place, radius: next }] })
					}}
					onFocus={field.onFocus}
					onBlur={() => void field.onBlur()}
				/>
				<span className="font-cond text-sm text-muted">m</span>
			</div>
			{error ? (
				<p id={`${id}-error`} role="alert" className="mt-1.5 font-cond text-xs text-warn">
					{error}
				</p>
			) : (
				<p id={`${id}-helper`} className={`mt-1.5 font-cond text-xs ${locked ? "text-head" : "text-muted"}`}>
					{helper}
				</p>
			)}
			{(place || mapArea) && (
				<div className="mt-3">
					<div className="relative">
						<LazyMap
							circle={locked ? place : (dragPlace ?? place)}
							framing={framing}
							edit={
								locked
									? null
									: {
											onPreview: (next) => {
												field.onFocus()
												setDragPlace(next)
											},
											onMove: (point) => {
												if (place) commit(locationAt(point))
											},
											onResize: (radius) => {
												if (value && place)
													commit({
														...value,
														places: [{ ...place, radius: Math.min(500, Math.max(5, Math.round(radius))) }],
													})
											},
											onCreate: (point) => {
												if (!place) commit(locationAt(point))
											},
										}
							}
						/>
						{!place && (
							<p className="pointer-events-none absolute inset-x-0 top-4 text-center font-cond text-sm text-head">
								Tap the map to drop the place
							</p>
						)}
					</div>
					{!locked && place && (
						<p className="mt-1.5 font-cond text-xs text-muted">
							Drag the pin to move the place. Drag the ring's handle to resize.
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
				{position.waiting && (
					<button
						type="button"
						onClick={position.cancel}
						className="min-h-11 font-cond text-sm text-link hover:underline active:text-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
					>
						Cancel
					</button>
				)}
				{!place && !mapArea && (
					<Link
						href={`/admin/seasons/${seasonId}/settings`}
						className="inline-flex min-h-11 items-center font-cond text-sm text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
					>
						Set a map area in Settings ›
					</Link>
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
			{place && (
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
								disabled={locked}
								onClick={() => {
									if (value && !locked) field.onChange({ ...value, guidance: choice })
								}}
								onFocus={field.onFocus}
								onBlur={() => void field.onBlur()}
								className={`min-h-11 rounded-md px-3 font-cond text-sm hover:text-head active:text-head focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60 ${guidance === choice ? "bg-accent text-head" : "text-muted"}`}
							>
								{label}
							</button>
						))}
					</div>
					<p id={`${id}-guidance-helper`} className="mt-1.5 font-cond text-xs text-muted">
						{guidance === "map"
							? "Players see the circle on a map and their own dot."
							: guidance === "warmer"
								? "Players see Far, Close or Very close, warmer or colder, and an arrow. Never the spot."
								: "Players get no hint of where the place is."}
					</p>
				</fieldset>
			)}
		</div>
	)
}
