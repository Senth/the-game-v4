"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { removeQuest } from "@/app/admin/tree-actions"
import type { Quest } from "@/lib/domain/schemas"
import { canEditStructure, questLabel } from "@/lib/domain/season-tree"
import { AutosaveTextField } from "./autosave-text-field"
import { ConfirmDialog } from "./confirm-dialog"
import { useSeasonClock } from "./use-season-clock"

export function QuestTitles({
	seasonId,
	arcId,
	quest,
	start,
	end,
	now,
}: {
	seasonId: string
	arcId: string
	quest: Pick<Quest, "id" | "displayTitle" | "internalTitle">
	start: Date | null
	end: Date | null
	now: number
}) {
	const router = useRouter()
	const editable = canEditStructure({ start, end }, new Date(useSeasonClock(now, start, end)))
	const label = questLabel(quest)
	const [confirming, setConfirming] = useState(false)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function remove() {
		if (pending || !editable) return
		setPending(true)
		setError(null)
		try {
			const result = await removeQuest(seasonId, arcId, quest.id)
			if (result.ok) router.push(`/admin/seasons/${seasonId}`)
			else setError(result.error)
		} catch {
			setError("Not saved, retry")
		} finally {
			setPending(false)
		}
	}

	return (
		<div>
			<div className="space-y-5">
				<AutosaveTextField
					label={
						<>
							Display title <span className="ml-2 font-body normal-case tracking-normal">players see this</span>
						</>
					}
					target={{ arcId, questId: quest.id, field: "displayTitle" }}
					serverValue={quest.displayTitle}
					autoFocus={label === null}
				/>
				<AutosaveTextField
					label={
						<>
							Internal title <span className="ml-2 font-body normal-case tracking-normal">admin only</span>
						</>
					}
					target={{ arcId, questId: quest.id, field: "internalTitle" }}
					serverValue={quest.internalTitle}
				/>
			</div>
			{editable && (
				<div className="mt-8 border-t border-z1 pt-2">
					<button
						type="button"
						className="min-h-11 font-cond text-sm text-muted hover:underline active:text-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
						disabled={pending}
						onClick={() => setConfirming(true)}
					>
						Remove quest
					</button>
					{error && (
						<p role="alert" className="font-cond text-xs text-warn">
							{error}
						</p>
					)}
				</div>
			)}
			<ConfirmDialog
				open={confirming}
				title={label ? `Remove ${label}?` : "Remove this quest?"}
				body="Its answers and hints go too."
				confirmLabel="Remove quest"
				disabled={pending || !editable}
				onConfirm={() => void remove()}
				onClose={() => setConfirming(false)}
			/>
		</div>
	)
}
