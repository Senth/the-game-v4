"use client"

import { useState } from "react"
import type { ActionResult } from "@/app/admin/action-result"
import { endSeason, shiftSeasonEnd, startSeasonNow } from "@/app/admin/live-actions"
import { seasonStatus, shiftEndWindow } from "@/lib/domain/admin-seasons"
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
}: {
	seasonId: string
	start: Date | null
	end: Date | null
	now: number
	teamCount: number
	hasQuests: boolean
}) {
	const currentNow = useSeasonClock(now, start, end)
	const status = seasonStatus({ start, end }, new Date(currentNow))
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [confirming, setConfirming] = useState(false)

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

	const confirmationDialog = ConfirmDialog({
		open: confirming,
		title: "End the game now?",
		body: `All ${teamCount} ${teamCount === 1 ? "team sees its" : "teams see their"} final score. You can add 5 minutes afterwards.`,
		confirmLabel: "End game",
		disabled: pending || status !== "live",
		onConfirm: () => void run(() => endSeason(seasonId)),
		onClose: () => setConfirming(false),
	})

	return (
		<div>
			<div className="grid grid-cols-3 gap-2 lg:flex">
				{status === "unscheduled" || status === "upcoming" ? (
					<button
						type="button"
						className={`${primaryClass} ${stripSize} col-span-3 px-4 active:bg-accent/80`}
						disabled={pending || !hasQuests}
						onClick={() => void run(() => startSeasonNow(seasonId))}
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
								onClick={() => setConfirming(true)}
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
