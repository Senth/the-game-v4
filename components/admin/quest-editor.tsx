"use client"

import { useRouter } from "next/navigation"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { addQuestToGame, getAddQuestImpact, getRemoveQuestImpact, removeQuest } from "@/app/admin/tree-actions"
import { seasonStatus } from "@/lib/domain/admin-seasons"
import type { StructuralEditImpact } from "@/lib/domain/game"
import { missingLabel as formatMissingFields, missingForGame } from "@/lib/domain/playable-quests"
import type { Quest } from "@/lib/domain/schemas"
import { canEditStructure, questLabel } from "@/lib/domain/season-tree"
import { AnswerChips } from "./answer-chips"
import { AutosavePointsField } from "./autosave-points-field"
import { useAssetDraft, useAutosave } from "./autosave-provider"
import { AutosaveTextField } from "./autosave-text-field"
import { AutosaveTextarea } from "./autosave-textarea"
import { ConfirmDialog, primaryClass } from "./confirm-dialog"
import { CopyDialog } from "./copy-dialog"
import { PuzzleSettings } from "./puzzle-settings"
import { QuestAsset, type QuestAssetHandle } from "./quest-asset"
import { RemovalImpact } from "./removal-impact"
import { useSeasonClock } from "./use-season-clock"

export function QuestEditor({
	seasonId,
	seasonTitle,
	arcId,
	arcTitle,
	hintCount,
	quest,
	reachedTeams = 0,
	start,
	end,
	now,
	children,
}: {
	seasonId: string
	seasonTitle: string
	arcId: string
	arcTitle: string
	hintCount: number
	quest: Omit<Quest, "hints">
	reachedTeams?: number
	start: Date | null
	end: Date | null
	now: number
	children?: ReactNode
}) {
	const router = useRouter()
	const autosave = useAutosave()
	const currentNow = new Date(useSeasonClock(now, start, end))
	const editable = canEditStructure({ start, end }, currentNow)
	const live = seasonStatus({ start, end }, currentNow) === "live"
	const canAddRemove = editable || live
	const label = questLabel(quest)
	const dialogLabel = label ?? "this quest"
	const missing = quest.hidden ? missingForGame(quest) : []
	const missingLabel = formatMissingFields(missing)
	const [confirming, setConfirming] = useState<"add" | "remove" | null>(null)
	const [copyOpen, setCopyOpen] = useState(false)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [impactFor, setImpactFor] = useState<"add" | "remove" | null>(null)
	const [impact, setImpact] = useState<StructuralEditImpact | null>(null)
	const [impactError, setImpactError] = useState<string | null>(null)
	const { value: assetPath, onChange: setAssetPath } = useAssetDraft(
		{ arcId, questId: quest.id, field: "assetPath" },
		quest.assetPath,
	)
	const lockedPuzzle = !!quest.puzzle && reachedTeams > 0
	const asset = useRef<QuestAssetHandle>(null)
	const dragDepth = useRef(0)
	const impactRequest = useRef(0)
	const [dragging, setDragging] = useState(false)
	const needsImpact = live && (confirming === "add" || (confirming === "remove" && !quest.hidden))
	const addImpact = impact?.kind === "addQuest" ? impact : null
	const removeImpact = impact?.kind === "deleteQuest" ? impact : null
	const impactErrorForDialog = impactFor === confirming ? impactError : null
	const impactLoading = needsImpact && !impactErrorForDialog && (impactFor !== confirming || !impact)

	useEffect(() => {
		if (!needsImpact || !confirming || impactFor === confirming) return
		const request = ++impactRequest.current
		setImpactFor(confirming)
		setImpact(null)
		setImpactError(null)
		const read =
			confirming === "add"
				? getAddQuestImpact(seasonId, arcId, quest.id)
				: getRemoveQuestImpact(seasonId, arcId, quest.id)
		void read
			.then((result) => {
				if (impactRequest.current !== request) return
				if (result.ok) setImpact(result.impact)
				else setImpactError(result.error)
			})
			.catch(() => {
				if (impactRequest.current === request) setImpactError("Not saved, retry")
			})
	}, [needsImpact, confirming, impactFor, seasonId, arcId, quest.id])

	function openConfirmation(mode: "add" | "remove") {
		impactRequest.current += 1
		setImpactFor(null)
		setImpact(null)
		setImpactError(null)
		setError(null)
		setConfirming(mode)
	}

	function closeConfirmation() {
		impactRequest.current += 1
		setConfirming(null)
		setImpactFor(null)
		setImpact(null)
		setImpactError(null)
	}

	async function remove() {
		if (pending || !canAddRemove || (live && !quest.hidden && !removeImpact)) return
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

	async function addToGame() {
		if (pending || !live || missing.length) return
		setPending(true)
		setError(null)
		try {
			const result = await addQuestToGame(seasonId, arcId, quest.id)
			if (result.ok) setConfirming(null)
			else setError(result.error)
		} catch {
			setError("Not saved, retry")
		} finally {
			setPending(false)
		}
	}

	const dialogTitle =
		confirming === "add" && addImpact?.added.length
			? `Add ${dialogLabel} for ${addImpact.added.length} teams?`
			: confirming === "add"
				? `Add ${dialogLabel} to the game?`
				: `Remove ${dialogLabel}?`
	const dialogBody: ReactNode =
		confirming === "add" ? (
			addImpact ? (
				<>
					<p>
						{addImpact.added.length
							? "Each team gets it at a random spot after its current quest."
							: "No team is playing it yet. Teams that start later get it."}
					</p>
					{addImpact.completed > 0 && (
						<p className="mt-2 font-cond text-xs text-muted">{addImpact.completed} teams finished and don't get it.</p>
					)}
				</>
			) : impactLoading ? (
				<p className="font-cond text-xs text-muted">Counting teams…</p>
			) : null
		) : confirming === "remove" && needsImpact && removeImpact ? (
			<RemovalImpact
				impact={removeImpact}
				onItLabel="On it now · skips it with 0 points"
				notReachedLabel="Not reached · leaves their order"
				solvedLabel={(count) => `${count} teams solved it and keep their points.`}
			/>
		) : needsImpact ? (
			impactLoading ? (
				<p className="font-cond text-xs text-muted">Counting teams…</p>
			) : null
		) : assetPath ? (
			"Its answers, hints and file go too."
		) : (
			"Its answers and hints go too."
		)
	const dialogDisabled =
		pending ||
		(confirming === "add" && (!live || missing.length > 0 || !addImpact)) ||
		(confirming === "remove" && (!canAddRemove || (needsImpact && !removeImpact)))

	return (
		<section
			aria-label="Quest editor"
			className="relative max-w-2xl"
			onDragEnter={(event) => {
				if (!event.dataTransfer.types.includes("Files")) return
				event.preventDefault()
				if (lockedPuzzle) return
				dragDepth.current++
				setDragging(true)
			}}
			onDragLeave={() => {
				if (dragDepth.current > 0 && --dragDepth.current === 0) setDragging(false)
			}}
			onDragOver={(event) => {
				if (!event.dataTransfer.types.includes("Files")) return
				event.preventDefault()
				event.dataTransfer.dropEffect = lockedPuzzle ? "none" : "copy"
			}}
			onDrop={(event) => {
				if (!event.dataTransfer.types.includes("Files")) return
				event.preventDefault()
				dragDepth.current = 0
				setDragging(false)
				if (lockedPuzzle) return
				const files = event.dataTransfer.files
				if (files.length > 1) asset.current?.setError("Drop one file at a time.")
				else if (files[0]) void asset.current?.upload(files[0])
			}}
		>
			<div className="space-y-5">
				{quest.hidden && (
					<div className="bg-z1 rounded-md p-3">
						<p className="font-body text-sm">
							{missing.length ? `Fill in ${missingLabel} to add it to the game.` : "Teams don't see this quest yet."}
						</p>
						{live && (
							<button
								type="button"
								className={`${primaryClass} mt-3`}
								disabled={pending || missing.length > 0}
								onClick={() => openConfirmation("add")}
							>
								Add to game
							</button>
						)}
						{error && (
							<p role="alert" className="mt-2 font-cond text-xs text-warn">
								{error}
							</p>
						)}
					</div>
				)}
				<div className="space-y-5 lg:grid lg:grid-cols-2 lg:gap-5 lg:space-y-0">
					<AutosaveTextField
						label={
							<>
								Display title <span className="ml-2 font-body normal-case tracking-normal">players see this</span>
							</>
						}
						target={{ arcId, questId: quest.id, field: "displayTitle" }}
						serverValue={quest.displayTitle}
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
					missing={assetPath?.trim() ? undefined : "Needs content or a file"}
					minRows={5}
					mono
				/>
				<QuestAsset
					ref={asset}
					seasonId={seasonId}
					arcId={arcId}
					questId={quest.id}
					assetPath={assetPath}
					locked={lockedPuzzle}
					onChange={setAssetPath}
				/>
				<div className="space-y-5 lg:grid lg:grid-cols-2 lg:gap-5 lg:space-y-0">
					<AnswerChips
						arcId={arcId}
						questId={quest.id}
						answers={quest.answers}
						missing={quest.puzzle ? undefined : "Needs an answer"}
						helper={quest.puzzle ? "optional, finishing the puzzle solves it" : undefined}
					/>
					<AutosavePointsField arcId={arcId} questId={quest.id} serverValue={quest.points} missing="Needs points" />
				</div>
				<PuzzleSettings
					arcId={arcId}
					questId={quest.id}
					assetPath={assetPath}
					puzzle={quest.puzzle}
					reachedTeams={reachedTeams}
				/>
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
			<div className="mt-8 border-t border-z1 pt-2">
				<button
					type="button"
					className="min-h-11 font-cond text-sm text-link hover:underline active:text-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
					disabled={pending}
					onClick={() => setCopyOpen(true)}
				>
					Copy to another season…
				</button>
				{canAddRemove && (
					<button
						type="button"
						className="block min-h-11 font-cond text-sm text-muted hover:underline active:text-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
						disabled={pending}
						onClick={() => openConfirmation("remove")}
					>
						Remove quest
					</button>
				)}
				{error && (
					<p role="alert" className="font-cond text-xs text-warn">
						{error}
					</p>
				)}
			</div>
			<ConfirmDialog
				open={confirming !== null}
				title={dialogTitle}
				body={dialogBody}
				confirmLabel={confirming === "add" ? "Add to game" : "Remove quest"}
				confirmTone={confirming === "add" ? "accent" : "danger"}
				disabled={dialogDisabled}
				error={impactErrorForDialog}
				onConfirm={() => void (confirming === "add" ? addToGame() : remove())}
				onClose={closeConfirmation}
			/>
			<CopyDialog
				mode="quest"
				open={copyOpen}
				sourceSeasonId={seasonId}
				sourceSeasonTitle={seasonTitle}
				sourceArc={{ id: arcId, title: arcTitle }}
				quest={{ id: quest.id, label: dialogLabel, hintCount }}
				onClose={() => setCopyOpen(false)}
			/>
			{dragging && (
				<div className="pointer-events-none absolute inset-0 z-10 hidden items-center justify-center rounded-md border-2 border-dashed border-accent bg-z0/85 lg:flex">
					<span className="font-head text-lg text-head">
						{assetPath ? "Drop to replace the file" : "Drop to add a file"}
					</span>
				</div>
			)}
		</section>
	)
}
