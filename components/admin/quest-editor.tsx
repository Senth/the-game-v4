"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { removeQuest } from "@/app/admin/tree-actions"
import type { Quest } from "@/lib/domain/schemas"
import { canEditStructure, questLabel } from "@/lib/domain/season-tree"
import { AnswerChips } from "./answer-chips"
import { AutosavePointsField } from "./autosave-points-field"
import { useAutosave } from "./autosave-provider"
import { AutosaveTextField } from "./autosave-text-field"
import { AutosaveTextarea } from "./autosave-textarea"
import { ConfirmDialog } from "./confirm-dialog"
import { QuestAsset } from "./quest-asset"
import { useSeasonClock } from "./use-season-clock"

export function QuestEditor({
	seasonId,
	arcId,
	quest,
	start,
	end,
	now,
}: {
	seasonId: string
	arcId: string
	quest: Omit<Quest, "hints">
	start: Date | null
	end: Date | null
	now: number
}) {
	const router = useRouter()
	const autosave = useAutosave()
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
			if (result.ok) {
				autosave?.discard({ arcId, questId: quest.id })
				router.push(`/admin/seasons/${seasonId}`)
			} else setError(result.error)
		} catch {
			setError("Not saved, retry")
		} finally {
			setPending(false)
		}
	}

	return (
		<div className="max-w-2xl">
			<div className="space-y-5">
				<div className="space-y-5 lg:grid lg:grid-cols-2 lg:gap-5 lg:space-y-0">
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
				<AutosaveTextarea
					label={
						<>
							Content <span className="ml-2 font-body normal-case tracking-normal">Markdown</span>
						</>
					}
					target={{ arcId, questId: quest.id, field: "content" }}
					serverValue={quest.content}
					minRows={5}
					mono
				/>
				<QuestAsset assetPath={quest.assetPath} />
				<div className="space-y-5 lg:grid lg:grid-cols-2 lg:gap-5 lg:space-y-0">
					<AnswerChips arcId={arcId} questId={quest.id} answers={quest.answers} />
					<AutosavePointsField arcId={arcId} questId={quest.id} serverValue={quest.points} />
				</div>
				<AutosaveTextarea
					label={
						<>
							Admin notes <span className="ml-2 font-body normal-case tracking-normal">admin only</span>
						</>
					}
					target={{ arcId, questId: quest.id, field: "adminNotes" }}
					serverValue={quest.adminNotes}
					minRows={1}
					mono={false}
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
