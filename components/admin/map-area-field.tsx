"use client"

import { type FormEvent, useEffect, useId, useState } from "react"
import { searchPlaces } from "@/app/admin/geocode-actions"
import { inputClass, labelClass } from "@/components/auth-form"
import LazyMap from "@/components/map/lazy-map"
import type { MapViewProps } from "@/components/map/map-view"
import { areaFromBounds } from "@/lib/domain/map"
import type { Season } from "@/lib/domain/schemas"
import type { PlaceSearchResult } from "@/lib/geocode/nominatim"
import { useAutosaveField } from "./autosave-provider"

type SearchState = "idle" | "results" | "empty" | "unavailable"

export function MapAreaField({ serverValue }: { serverValue: Season["mapArea"] }) {
	const field = useAutosaveField<Season["mapArea"]>({ field: "mapArea" }, serverValue ?? null)
	const [query, setQuery] = useState("")
	const [results, setResults] = useState<PlaceSearchResult[]>([])
	const [searchState, setSearchState] = useState<SearchState>("idle")
	const [searching, setSearching] = useState(false)
	const [framing, setFraming] = useState<MapViewProps["framing"]>(() => field.value ?? serverValue ?? null)
	const id = useId()

	useEffect(() => setFraming(field.value), [field.value])

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setSearching(true)
		setResults([])
		try {
			const result = await searchPlaces(query)
			if (!result.ok) {
				setSearchState("unavailable")
				return
			}
			setResults(result.results)
			setSearchState(result.results.length ? "results" : "empty")
		} catch {
			setSearchState("unavailable")
		} finally {
			setSearching(false)
		}
	}

	function pick(result: PlaceSearchResult) {
		setResults([])
		setFraming({ bounds: areaFromBounds(result.bbox), maxZoom: 17 })
		setSearchState("idle")
	}

	return (
		<section className="space-y-2">
			<h3 className={labelClass}>Map area</h3>
			{framing && (
				<div className="relative">
					<LazyMap
						framing={framing}
						minZoom={2}
						maxZoom={19}
						onMoveEnd={(area, manual) => {
							if (!manual && !(framing && "bounds" in framing)) return
							field.onFocus()
							field.onChange(area)
							void field.onBlur()
							if (!manual) setFraming(area)
						}}
					/>
					<svg
						aria-hidden="true"
						className="pointer-events-none absolute left-1/2 top-1/2 z-10 size-6 -translate-x-1/2 -translate-y-1/2 text-head"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
					>
						<path d="M12 2v20M2 12h20" />
						<circle cx="12" cy="12" r="3" fill="var(--color-z0)" />
					</svg>
				</div>
			)}
			<form className="space-y-2" onSubmit={submit}>
				<label htmlFor={`${id}-search`} className={labelClass}>
					Search
				</label>
				<div className="flex gap-2">
					<input
						id={`${id}-search`}
						className={`${inputClass} min-w-0 flex-1`}
						type="search"
						minLength={2}
						maxLength={200}
						required
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
					<button
						className="min-h-11 rounded-md bg-accent px-4 font-cond text-sm font-medium text-white hover:bg-accent/90 active:bg-accent/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
						type="submit"
						disabled={searching}
					>
						{searching ? "Searching…" : "Search"}
					</button>
				</div>
			</form>
			{searchState === "results" && (
				<ul aria-label="Search results" className="space-y-1">
					{results.map((result) => (
						<li key={`${result.lat}:${result.lng}:${result.label}`}>
							<button
								className="min-h-11 w-full rounded-md px-3 text-left font-cond text-sm text-link hover:bg-z1 active:text-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
								type="button"
								onClick={() => pick(result)}
							>
								{result.label}
							</button>
						</li>
					))}
				</ul>
			)}
			{searchState === "empty" && (
				<p role="status" className="font-cond text-xs text-warn">
					No places match. Check the spelling or try a nearby town.
				</p>
			)}
			{searchState === "unavailable" && (
				<p role="alert" className="font-cond text-xs text-warn">
					Search unavailable. Try again.
				</p>
			)}
			{searchState !== "idle" && <p className="font-cond text-xs text-muted">Search © OpenStreetMap contributors</p>}
			{field.failed && (
				<p role="alert" className="font-cond text-xs text-warn">
					{field.error ?? "Not saved"}
				</p>
			)}
			<p className="font-cond text-xs text-muted">
				{framing
					? "New places start on this map. Existing places never change."
					: "Search for where this season plays. New places start there."}
			</p>
		</section>
	)
}
