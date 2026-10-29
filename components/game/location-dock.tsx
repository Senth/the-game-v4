"use client"

import { type ComponentProps, useEffect, useRef } from "react"
import type { Positions } from "@/lib/game/positions"
import { AnswerDock } from "./answer-dock"
import type { useCompass } from "./use-compass"
import type { LocationStatus } from "./use-location-reporter"

type LocationDockProps = ComponentProps<typeof AnswerDock> & {
	hasAnswers: boolean
	state?: LocationStatus["state"]
	accuracy?: number
	guidanceEnabled?: boolean
	mapEnabled?: boolean
	placeCount?: number
	positions?: Positions
	you?: string
	guidance?: LocationStatus["guidance"]
	compass?: ReturnType<typeof useCompass>
	pointsEarned?: number
	onShare?: () => void
}

const labels = {
	off: "Location off",
	on: "Location on",
	rough: "GPS too rough",
	blocked: "Location blocked",
	unavailable: "Location unavailable",
}
const helpers = {
	off: "Arriving at the place solves this quest. Share your location so the game can tell. Keep this screen open and unlocked.",
	on: "Walk to the place. Arriving solves the quest. Keep this screen open and unlocked.",
	rough: "Step out into the open and wait a few seconds. The game keeps trying.",
	blocked:
		"Chrome on Android: tap the icon left of the address, then Permissions › Location › Allow. iPhone: Settings › Apps › Safari › Location › Allow. Then reload this page.",
	unavailable: "This browser can't share location.",
	arrow: "Hold the phone flat and follow the arrow. Arriving solves the quest. Keep this screen open and unlocked.",
	veryClose: "Look around, the place is right here. Keep this screen open and unlocked.",
	noCompass:
		"This phone has no compass, so there's no arrow. Walk and watch the meter. Keep this screen open and unlocked.",
	refused: "The arrow needs motion access. Walk and watch the meter. Keep this screen open and unlocked.",
	beforeTap: "Arriving solves the quest. Keep this screen open and unlocked.",
	finding: "Finding which way to go. Keep this screen open and unlocked.",
}
const bands = ["far", "close", "veryClose"] as const
const bandLabels = ["Far", "Close", "Very close"] as const
type Rotation = { target: number; rotation: number }

export function nextRotation(previous: Rotation | null, bearing: number, heading: number): Rotation {
	const target = ((bearing - heading + 540) % 360) - 180
	const delta = previous ? ((target - previous.target + 540) % 360) - 180 : 0
	return { target, rotation: (previous?.rotation ?? target) + delta }
}

export function LocationDock(props: LocationDockProps) {
	const previousRotation = useRef<Rotation | null>(null)
	const state = props.preview ? "off" : (props.state ?? "off")
	const found = !props.preview && props.pointsEarned !== undefined
	const coverage = !found && (props.placeCount ?? 1) > 1
	const places = Array.from({ length: props.placeCount ?? 1 }, (_, index) => {
		const held = !props.preview && !!props.positions?.places[index]?.held
		const name = held ? props.positions?.phones.find((phone) => phone.place === index + 1)?.name : undefined
		return { number: index + 1, held, label: name ? (name === props.you ? "You" : name) : "Empty" }
	})
	const warning = state === "rough" || state === "blocked" || state === "unavailable"
	const pulse = !found && (state === "on" || state === "rough")
	const codes = props.hasAnswers
	const guided = !found && !props.preview && state === "on" && props.guidanceEnabled === true
	const guidance = guided ? props.guidance : undefined
	const compassState = props.compass?.state
	const arrow =
		guidance?.band !== undefined &&
		guidance.band !== "veryClose" &&
		compassState === "on" &&
		props.compass?.heading !== undefined &&
		guidance.bearing !== undefined
	const helper =
		guidance?.band === "veryClose"
			? helpers.veryClose
			: compassState === "needsTap"
				? helpers.beforeTap
				: compassState === "refused"
					? helpers.refused
					: guidance
						? arrow
							? helpers.arrow
							: helpers.noCompass
						: helpers.finding
	const statusWord = guidance?.trend === "warmer" ? "Warmer" : guidance?.trend === "colder" ? "Colder" : labels[state]
	const statusColor =
		guidance?.trend === "warmer"
			? "text-warn font-bold"
			: guidance?.trend === "colder"
				? "text-muted font-bold"
				: "text-head"
	const distanceBand = guidance?.band ? bands.indexOf(guidance.band) : -1
	const rotationState =
		arrow && guidance?.bearing !== undefined && props.compass?.heading !== undefined
			? nextRotation(previousRotation.current, guidance.bearing, props.compass.heading)
			: null
	useEffect(() => {
		previousRotation.current = rotationState
	}, [rotationState])
	const rotation = rotationState?.rotation ?? 0
	const status = (
		<div className={`px-4 pt-3 ${codes ? "pb-1" : "pb-[calc(var(--spacing)*6+env(safe-area-inset-bottom))]"}`}>
			{guided ? (
				<>
					<div className="flex items-center gap-2.5 font-cond">
						{arrow ? (
							<span aria-hidden="true" className="size-8 shrink-0 grid place-items-center">
								<svg
									aria-hidden="true"
									viewBox="0 0 24 24"
									className="size-8 shrink-0 text-head transition-transform motion-reduce:transition-none"
									style={{ transform: `rotate(${rotation}deg)` }}
								>
									<path d="M12 2 L20 21 L12 16.5 L4 21 Z" fill="currentColor" />
								</svg>
							</span>
						) : (
							<span aria-hidden="true" className="size-8 shrink-0 grid place-items-center">
								<span className="size-2.5 shrink-0 rounded-full bg-pace-ok motion-safe:animate-pulse" />
							</span>
						)}
						<span role="status" className={`text-sm ${statusColor}`}>
							{statusWord}
						</span>
						{props.accuracy !== undefined && (
							<span className="ml-auto text-xs text-muted">±{Math.round(props.accuracy)} m</span>
						)}
					</div>
					<div className="mt-2.5 grid min-w-0 grid-cols-3 gap-2">
						{bandLabels.map((label, index) => (
							<div key={label}>
								<div
									aria-hidden="true"
									className={`h-1 rounded-full ${index <= distanceBand ? "bg-head" : "bg-z2/60"}`}
								/>
								<p
									aria-current={index === distanceBand ? "step" : undefined}
									className={`mt-1 font-cond text-xs ${index === distanceBand ? "text-head" : "text-muted"}`}
								>
									{label}
								</p>
							</div>
						))}
					</div>
					<p className="mt-2 font-cond text-xs leading-relaxed text-muted">{helper}</p>
					{compassState === "needsTap" && (
						<button
							type="button"
							onClick={() => props.compass?.request()}
							className="mt-3 min-h-11 rounded-md border border-z2 px-4 font-cond text-sm text-ink hover:bg-z2/30 focus-visible:outline-2 focus-visible:outline-link active:bg-z2/60"
						>
							Show arrow
						</button>
					)}
				</>
			) : (
				<div role="status">
					<div className="flex items-center gap-2.5 font-cond">
						<span
							aria-hidden="true"
							className={`size-2.5 shrink-0 rounded-full ${found || state === "on" ? "bg-pace-ok" : warning ? "bg-warn" : "bg-muted"} ${pulse ? "motion-safe:animate-pulse" : ""}`}
						/>
						<span
							className={`text-sm ${coverage && state === "on" ? "font-bold " : ""}${found ? "text-pace-ok" : warning ? "text-warn" : "text-head"}`}
						>
							{found
								? `Found it · ${(props.pointsEarned ?? 0) >= 0 ? "+" : ""}${props.pointsEarned}p`
								: coverage && state === "on"
									? `${places.filter((place) => place.held).length} of ${places.length} places held`
									: labels[state]}
						</span>
						{!found && !props.preview && props.accuracy !== undefined && (
							<span className={`ml-auto text-xs ${state === "rough" ? "text-warn" : "text-muted"}`}>
								±{Math.round(props.accuracy)} m
							</span>
						)}
					</div>
					{coverage && (
						<div className={`mt-2.5 grid min-w-0 ${places.length === 2 ? "grid-cols-2" : "grid-cols-3"} gap-2`}>
							{places.map((place) => (
								<div key={place.number} className="min-w-0">
									<div aria-hidden="true" className={`h-1 rounded-full ${place.held ? "bg-pace-ok" : "bg-z2/60"}`} />
									<p className={`mt-1 break-words font-cond text-xs ${place.held ? "text-ink" : "text-muted"}`}>
										{place.number} · {place.label}
									</p>
								</div>
							))}
						</div>
					)}
					<p className={`${coverage ? "mt-2" : "mt-1.5 ml-5"} font-cond text-xs leading-relaxed text-muted`}>
						{found
							? "Next quest in a moment."
							: coverage && state === "on"
								? "Each circle needs a different teammate inside it at the same time. Keep this screen open and unlocked."
								: state === "on" && props.mapEnabled
									? "Walk into the circle. Arriving solves the quest. Keep this screen open and unlocked."
									: helpers[state]}
					</p>
				</div>
			)}
			{!found && (state === "off" || state === "blocked") && (
				<button
					type="button"
					disabled={!!props.preview}
					onClick={state === "blocked" ? () => window.location.reload() : props.onShare}
					className="mt-3 min-h-11 w-full rounded-md bg-accent px-4 font-cond text-sm font-bold text-white hover:bg-accent/80 focus-visible:outline-2 focus-visible:outline-link active:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{state === "blocked" ? "Reload" : "Share location"}
				</button>
			)}
		</div>
	)
	return (
		<AnswerDock {...(found ? { preview: true } : props)} showAnswer={codes} placeholder="Code from the sign">
			{status}
		</AnswerDock>
	)
}
