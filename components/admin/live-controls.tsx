"use client"

import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { ActionResult } from "@/app/admin/action-result"
import { endSeason, shiftSeasonEnd, startSeasonNow } from "@/app/admin/live-actions"
import { buttonClass } from "@/components/auth-form"
import { seasonStatus, shiftEndWindow } from "@/lib/domain/admin-seasons"
import { useSeasonClock } from "./use-season-clock"

const primaryClass = buttonClass.replace("h-12 w-full", "h-11").replace("text-lg font-bold", "text-sm font-medium")
const outlineClass =
	"h-11 rounded-md border px-3 font-cond text-sm text-ink hover:bg-z2/50 active:bg-z2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
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
	const dialog = useRef<HTMLDialogElement>(null)
	const cancel = useRef<HTMLButtonElement>(null)
	const titleId = useId()
	const bodyId = useId()
	useEffect(() => {
		if (confirming) {
			dialog.current?.showModal()
			cancel.current?.focus()
		}
	}, [confirming])

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
			{confirming &&
				createPortal(
					<dialog
						ref={dialog}
						aria-labelledby={titleId}
						aria-describedby={bodyId}
						className="m-auto w-[calc(100%-var(--spacing)*12)] max-w-sm rounded-md bg-z1 p-5 text-ink backdrop:bg-z0/60"
						onClose={() => setConfirming(false)}
					>
						<h2 id={titleId} className="font-head text-lg text-head">
							End the game now?
						</h2>
						<p id={bodyId} className="mt-2 font-body text-sm">
							All {teamCount} {teamCount === 1 ? "team sees its" : "teams see their"} final score. You can add 5 minutes
							afterwards.
						</p>
						<div className="mt-5 grid grid-cols-2 gap-2">
							<button
								ref={cancel}
								type="button"
								className={`${outlineClass} border-z2`}
								onClick={() => dialog.current?.close()}
							>
								Cancel
							</button>
							<button
								type="button"
								className={primaryClass.replaceAll("accent", "pace-3")}
								disabled={pending || status !== "live"}
								onClick={() => {
									dialog.current?.close()
									void run(() => endSeason(seasonId))
								}}
							>
								End game
							</button>
						</div>
					</dialog>,
					document.body,
				)}
		</div>
	)
}
