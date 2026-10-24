"use client"

import { useEffect, useId, useState } from "react"
import { inputClass, labelClass } from "@/components/auth-form"
import { newPlace, osmUrl, parseCoordinates } from "@/lib/domain/location"
import type { Quest } from "@/lib/domain/schemas"
import { useAutosaveField } from "./autosave-provider"

export function PlaceField({
	arcId,
	questId,
	location,
	puzzle,
	seasonRadius,
	solvedTeams,
}: {
	arcId: string
	questId: string
	location: Quest["location"]
	puzzle: Quest["puzzle"]
	seasonRadius: number
	solvedTeams: number
}) {
	const field = useAutosaveField<Quest["location"]>({ arcId, questId, field: "location" }, location ?? null)
	const value = field.value ?? null
	const place = value?.places[0]
	const warmer = value?.guidance === "warmer"
	const savedCoordinates = place ? `${place.lat}, ${place.lng}` : ""
	const [coordinates, setCoordinates] = useState(() => (place ? `${place.lat}, ${place.lng}` : ""))
	const [pasteError, setPasteError] = useState(false)
	const id = useId()
	const locked = solvedTeams > 0
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
			? "Getting within the radius solves it. Players never see the coordinates."
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

	function changeCoordinates(input: string) {
		setCoordinates(input)
		if (!input.trim()) {
			setPasteError(false)
			field.onChange(null)
			return
		}
		try {
			const parsed = parseCoordinates(input)
			setPasteError(false)
			field.onChange(
				value && place
					? { ...value, places: [{ ...place, ...parsed }] }
					: { guidance: "none", places: [newPlace({ placeRadius: seasonRadius }, parsed.lat, parsed.lng)] },
			)
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
					value={coordinates}
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
					value={place?.radius ?? seasonRadius}
					disabled={locked || !place}
					onChange={(event) => {
						if (!place || !value || locked) return
						field.onChange({ ...value, places: [{ ...place, radius: event.target.valueAsNumber }] })
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
			{place && (
				<a
					className="inline-flex min-h-11 items-center font-cond text-sm text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
					href={osmUrl(place.lat, place.lng)}
					target="_blank"
					rel="noreferrer"
				>
					Check on map ›
				</a>
			)}
			{place && (
				<div className="mt-3 flex min-h-11 items-start justify-between gap-3">
					<div className="min-w-0">
						<p id={`${id}-guidance-label`} className={`font-cond text-sm ${locked ? "text-muted" : "text-ink"}`}>
							Warmer/colder
						</p>
						<p id={`${id}-guidance-helper`} className="font-cond text-xs text-muted">
							{warmer
								? "Players see Far, Close or Very close, warmer or colder, and an arrow. Never the spot."
								: "Players get no hint of where the place is."}
						</p>
					</div>
					<button
						type="button"
						role="switch"
						aria-checked={warmer}
						aria-labelledby={`${id}-guidance-label`}
						aria-describedby={`${id}-guidance-helper${error ? ` ${id}-error` : ""}`}
						disabled={locked}
						onClick={() => {
							if (value) field.onChange({ ...value, guidance: warmer ? "none" : "warmer" })
						}}
						onFocus={field.onFocus}
						onBlur={() => void field.onBlur()}
						className="mt-1 flex h-11 w-12 shrink-0 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
					>
						<span
							aria-hidden="true"
							className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 ${warmer ? "bg-accent" : "bg-z2"}`}
						>
							<span className={`size-5 rounded-full bg-head${warmer ? " ml-auto" : ""}`} />
						</span>
					</button>
				</div>
			)}
		</div>
	)
}
