"use client"

import type { ComponentProps } from "react"
import { AnswerDock } from "./answer-dock"
import type { LocationStatus } from "./use-location-reporter"

type LocationDockProps = ComponentProps<typeof AnswerDock> & {
	hasAnswers: boolean
	state?: LocationStatus["state"]
	accuracy?: number
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
}

export function LocationDock(props: LocationDockProps) {
	const state = props.preview ? "off" : (props.state ?? "off")
	const found = !props.preview && props.pointsEarned !== undefined
	const warning = state === "rough" || state === "blocked" || state === "unavailable"
	const pulse = !found && (state === "on" || state === "rough")
	const codes = props.hasAnswers
	const status = (
		<div className={`px-4 pt-3 ${codes ? "pb-1" : "pb-[calc(var(--spacing)*6+env(safe-area-inset-bottom))]"}`}>
			<div role="status">
				<div className="flex items-center gap-2.5 font-cond">
					<span
						aria-hidden="true"
						className={`size-2.5 shrink-0 rounded-full ${found || state === "on" ? "bg-pace-ok" : warning ? "bg-warn" : "bg-muted"} ${pulse ? "motion-safe:animate-pulse" : ""}`}
					/>
					<span className={`text-sm ${found ? "text-pace-ok" : warning ? "text-warn" : "text-head"}`}>
						{found ? `Found it · ${(props.pointsEarned ?? 0) >= 0 ? "+" : ""}${props.pointsEarned}p` : labels[state]}
					</span>
					{!found && !props.preview && props.accuracy !== undefined && (
						<span className={`ml-auto text-xs ${state === "rough" ? "text-warn" : "text-muted"}`}>
							±{Math.round(props.accuracy)} m
						</span>
					)}
				</div>
				<p className="mt-1.5 ml-5 font-cond text-xs leading-relaxed text-muted">
					{found ? "Next quest in a moment." : helpers[state]}
				</p>
			</div>
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
