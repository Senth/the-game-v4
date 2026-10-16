"use client"

import { useRouter } from "next/navigation"
import { type ReactNode, useRef, useState } from "react"
import { removeQuest } from "@/app/admin/tree-actions"
import type { Quest } from "@/lib/domain/schemas"
import { canEditStructure, questLabel } from "@/lib/domain/season-tree"
import { AnswerChips } from "./answer-chips"
import { AutosavePointsField } from "./autosave-points-field"
import { useAssetDraft, useAutosave } from "./autosave-provider"
import { AutosaveTextField } from "./autosave-text-field"
import { AutosaveTextarea } from "./autosave-textarea"
import { ConfirmDialog } from "./confirm-dialog"
import { QuestAsset, type QuestAssetHandle } from "./quest-asset"
import { useSeasonClock } from "./use-season-clock"

export function QuestEditor({
	seasonId,
	arcId,
	quest,
	start,
	end,
	now,
	children,
}: {
	seasonId: string
	arcId: string
	quest: Omit<Quest, "hints">
	start: Date | null
	end: Date | null
	now: number
	children?: ReactNode
}) {
	const router = useRouter()
	const autosave = useAutosave()
	const editable = canEditStructure({ start, end }, new Date(useSeasonClock(now, start, end)))
	const label = questLabel(quest)
	const [confirming, setConfirming] = useState(false)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const { value: assetPath, onChange: setAssetPath } = useAssetDraft(
		{ arcId, questId: quest.id, field: "assetPath" },
		quest.assetPath,
	)
	const asset = useRef<QuestAssetHandle>(null)
	const dragDepth = useRef(0)
	const [dragging, setDragging] = useState(false)

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
		<section
			aria-label="Quest editor"
			className="relative max-w-2xl"
			onDragEnter={(event) => {
				if (!event.dataTransfer.types.includes("Files")) return
				event.preventDefault()
				dragDepth.current++
				setDragging(true)
			}}
			onDragLeave={() => {
				if (dragDepth.current > 0 && --dragDepth.current === 0) setDragging(false)
			}}
			onDragOver={(event) => {
				if (!event.dataTransfer.types.includes("Files")) return
				event.preventDefault()
				event.dataTransfer.dropEffect = "copy"
			}}
			onDrop={(event) => {
				if (!event.dataTransfer.types.includes("Files")) return
				event.preventDefault()
				dragDepth.current = 0
				setDragging(false)
				const files = event.dataTransfer.files
				if (files.length > 1) asset.current?.setError("Drop one file at a time.")
				else if (files[0]) void asset.current?.upload(files[0])
			}}
		>
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
				<QuestAsset
					ref={asset}
					seasonId={seasonId}
					arcId={arcId}
					questId={quest.id}
					assetPath={assetPath}
					onChange={setAssetPath}
				/>
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
				{children}
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
				body={assetPath ? "Its answers, hints and image go too." : "Its answers and hints go too."}
				confirmLabel="Remove quest"
				disabled={pending || !editable}
				onConfirm={() => void remove()}
				onClose={() => setConfirming(false)}
			/>
			{dragging && (
				<div className="pointer-events-none absolute inset-0 z-10 hidden items-center justify-center rounded-md border-2 border-dashed border-accent bg-z0/85 lg:flex">
					<span className="font-head text-lg text-head">
						{assetPath ? "Drop to replace the image" : "Drop to add an image or PDF"}
					</span>
				</div>
			)}
		</section>
	)
}
