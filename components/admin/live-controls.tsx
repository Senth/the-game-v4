"use client"

import { useState } from "react"
import type { ActionResult } from "@/app/admin/action-result"
import { endSeason, shiftSeasonEnd, startSeasonNow } from "@/app/admin/live-actions"
import { seasonStatus, shiftEndWindow } from "@/lib/domain/admin-seasons"
import { missingLabel } from "@/lib/domain/playable-quests"
import { ConfirmDialog, outlineClass, primaryClass } from "./confirm-dialog"
import { useSeasonClock } from "./use-season-clock"

const stripSize = "relative lg:h-9 lg:after:absolute lg:after:inset-x-0 lg:after:-inset-y-1.5"

export function LiveControls({
	seasonId,
	start,
	end,
	now,
	teamCount,
	hasQuests,
	incomplete,
}: {
	seasonId: string
	start: Date | null
	end: Date | null
	now: number
	teamCount: number
	hasQuests: boolean
	incomplete: { id: string; label: string; missing: string[] }[]
}) {
	const currentNow = useSeasonClock(now, start, end)
	const status = seasonStatus({ start, end }, new Date(currentNow))
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [confirming, setConfirming] = useState<"end" | "start" | null>(null)

	async function run(action: () => Promise<ActionResult>) {
		if (pending) return
		setPending(true)
		setError(null)
		try {
			const result = await action()
			if (!result.ok) setError(result.error)
		} catch {
			setError("Not saved, retry")
		} finally {
			setPending(false)
		}
	}

	const starting = confirming === "start"
	const confirmationDialog = ConfirmDialog({
		open: confirming !== null,
		title: starting
			? `Start with ${incomplete.length} incomplete quest${incomplete.length === 1 ? "" : "s"}?`
			: "End the game now?",
		body: starting ? (
			<>
				<ul className="space-y-2">
					{incomplete.slice(0, 5).map((quest) => (
						<li key={quest.id}>
							<div>{quest.label}</div>
							<div className="font-cond text-xs text-warn">{missingLabel(quest.missing)}</div>
						</li>
					))}
					{incomplete.length > 5 && <li className="font-cond text-xs text-muted">and {incomplete.length - 5} more</li>}
				</ul>
				<p className="mt-3">Teams get them as they are. A quest without answers can't be solved.</p>
			</>
		) : (
			`All ${teamCount} ${teamCount === 1 ? "team sees its" : "teams see their"} final score. You can add 5 minutes afterwards.`
		),
		confirmLabel: starting ? "Start anyway" : "End game",
		confirmTone: starting ? "accent" : "danger",
		disabled: pending || (starting ? status !== "unscheduled" && status !== "upcoming" : status !== "live"),
		onConfirm: () => void run(() => (starting ? startSeasonNow(seasonId) : endSeason(seasonId))),
		onClose: () => setConfirming(null),
	})

	return (
		<div>
			<div className="grid grid-cols-3 gap-2 lg:flex">
				{status === "unscheduled" || status === "upcoming" ? (
					<button
						type="button"
						className={`${primaryClass} ${stripSize} col-span-3 px-4 active:bg-accent/80`}
						disabled={pending || !hasQuests}
						onClick={() => (incomplete.length ? setConfirming("start") : void run(() => startSeasonNow(seasonId)))}
					>
						Start now
					</button>
				) : (
					<>
						{status === "live" && (
							<button
								type="button"
								className={`${outlineClass} ${stripSize} border-z2`}
								disabled={pending || shiftEndWindow({ start, end }, -5, new Date(currentNow)) === null}
								onClick={() => void run(() => shiftSeasonEnd(seasonId, -5))}
							>
								−5 min
							</button>
						)}
						<button
							type="button"
							className={`${outlineClass} ${stripSize} border-z2`}
							disabled={pending}
							onClick={() => void run(() => shiftSeasonEnd(seasonId, 5))}
						>
							+5 min
						</button>
						{status === "live" && (
							<button
								type="button"
								className={`${outlineClass} ${stripSize} border-pace-3`}
								disabled={pending}
								onClick={() => setConfirming("end")}
							>
								End game
							</button>
						)}
					</>
				)}
			</div>
			{(status === "unscheduled" || status === "upcoming") && !hasQuests && (
				<p className="mt-2 font-cond text-xs text-muted">Add a quest first.</p>
			)}
			{error && (
				<p role="alert" className="mt-2 font-cond text-xs text-warn">
					{error}
				</p>
			)}
			{confirmationDialog}
		</div>
	)
}
