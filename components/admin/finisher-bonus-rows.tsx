"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { addFinisherBonus, removeLastFinisherBonus } from "@/app/admin/autosave-actions"
import { inputClass, labelClass } from "@/components/auth-form"
import { FinishFlag } from "@/components/finish-flag"
import { ordinal } from "@/lib/domain/game"
import type { Season } from "@/lib/domain/schemas"
import { useAutosave, useAutosaveField } from "./autosave-provider"

function BonusPoints({ index, points }: { index: number; points: number }) {
	const field = useAutosaveField({ field: "finisherBonuses", index: String(index) }, points)
	const errorId = `finisher-bonus-${index}-error`
	return (
		<div>
			<div className="flex items-center gap-2">
				<input
					aria-label={`${ordinal(index + 1)} place points`}
					aria-invalid={field.failed || undefined}
					aria-describedby={field.failed ? errorId : undefined}
					className={`${(field.failed ? inputClass.replaceAll("border-z2", "border-warn").replaceAll("focus:border-accent", "focus:border-warn") : inputClass).replace("w-full", "w-20")} min-w-0 text-sm`}
					type="number"
					inputMode="numeric"
					min={0}
					max={10000}
					step={1}
					value={Number.isNaN(field.value) ? "" : field.value}
					onChange={(event) => field.onChange(event.target.valueAsNumber)}
					onFocus={field.onFocus}
					onBlur={field.onBlur}
				/>
				<span className="text-muted">p</span>
			</div>
			{field.failed && (
				<p id={errorId} role="alert" className="mt-1.5 text-xs text-warn">
					{field.error ?? "Not saved"}
				</p>
			)}
		</div>
	)
}

export function FinisherBonusRows({
	season,
	teams,
}: {
	season: Pick<Season, "_id" | "finisherBonuses" | "finishers">
	teams: { _id: string; name: string }[]
}) {
	const router = useRouter()
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string>()
	const bonuses = season.finisherBonuses ?? []
	const finishers = season.finishers ?? []
	const autosave = useAutosave()
	const discard = autosave?.discard
	const drafts = autosave?.drafts
	useEffect(() => {
		if (!drafts || !discard) return
		for (const draft of drafts.values()) {
			if (draft.target.field !== "finisherBonuses") continue
			const index = Number(draft.target.index)
			if (index >= bonuses.length || finishers.some((finisher) => finisher.place === index + 1)) {
				discard({ field: "finisherBonuses", index: String(index) })
			}
		}
	}, [bonuses.length, finishers, drafts, discard])
	async function change(remove: boolean) {
		if (pending) return
		setPending(true)
		setError(undefined)
		try {
			const result = await (remove ? removeLastFinisherBonus(season._id) : addFinisherBonus(season._id, 0))
			if (result.ok) {
				if (remove) discard?.({ field: "finisherBonuses", index: String(bonuses.length - 1) })
				router.refresh()
			} else setError(result.error)
		} catch {
			setError("Not saved, retry")
		} finally {
			setPending(false)
		}
	}
	return (
		<section aria-label="Finisher bonus" className="font-cond text-sm">
			<h3 className={labelClass}>Finisher bonus</h3>
			{bonuses.length === 0 && <p className="text-muted">No bonus</p>}
			{bonuses.map((points, index) => {
				const finisher = finishers.find((item) => item.place === index + 1)
				return (
					<div key={ordinal(index + 1)} className="flex min-h-11 items-center gap-3">
						<span className={`w-8 shrink-0${finisher ? " text-muted" : ""}`}>{ordinal(index + 1)}</span>
						{finisher ? (
							<>
								<span className="text-muted">
									{finisher.points}
									<span className="ml-2">p</span>
								</span>
								<span className="flex min-w-0 items-center gap-2">
									<FinishFlag />
									<span className="truncate text-muted">
										{teams.find((team) => team._id === finisher.teamId)?.name ?? "Deleted team"}
									</span>
								</span>
							</>
						) : (
							<>
								<BonusPoints index={index} points={points} />
								{index === bonuses.length - 1 && (
									<button
										type="button"
										aria-label={`Remove ${ordinal(index + 1)} place`}
										className="min-h-11 min-w-11 text-link hover:text-head focus-visible:outline-accent disabled:opacity-50"
										disabled={pending}
										onClick={() => void change(true)}
									>
										✕
									</button>
								)}
							</>
						)}
					</div>
				)
			})}
			<button
				type="button"
				className="min-h-11 text-link hover:text-head focus-visible:outline-accent disabled:opacity-50"
				disabled={pending}
				onClick={() => void change(false)}
			>
				+ Add place
			</button>
			{error && (
				<p role="alert" className="mt-1.5 text-xs text-warn">
					{error}
				</p>
			)}
			<p className="mt-1.5 text-xs text-muted">Points for the first teams to finish. Row 1 is first place.</p>
		</section>
	)
}
