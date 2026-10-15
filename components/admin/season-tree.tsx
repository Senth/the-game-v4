"use client"

import { type DragOverEvent, useDndMonitor, useDroppable } from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import Link from "next/link"
import { useRouter, useSelectedLayoutSegments } from "next/navigation"
import { type ReactNode, useEffect, useRef, useState } from "react"
import type { ActionResult } from "@/app/admin/action-result"
import {
	addArc,
	addQuest,
	removeArc,
	moveArc as saveArcMove,
	moveQuest as saveQuestMove,
} from "@/app/admin/tree-actions"
import { moveArc, moveQuest } from "@/lib/domain/reorder"
import type { Arc } from "@/lib/domain/schemas"
import { canEditStructure, type treeView } from "@/lib/domain/season-tree"
import { useAutosave, useAutosaveField } from "./autosave-provider"
import { AutosaveTextField } from "./autosave-text-field"
import { ConfirmDialog, outlineClass } from "./confirm-dialog"
import { SortableDragLayer, SortableRow } from "./sortable/drag-layer"
import { useMoveQueue } from "./sortable/use-move-queue"
import { useSeasonClock } from "./use-season-clock"

type Tree = ReturnType<typeof treeView>
type Variant = "menu" | "page"
type TreeMove =
	| { kind: "arc"; id: string; beforeId: string | null }
	| {
			kind: "quest"
			id: string
			toArcId: string
			beforeId: string | null
	  }
type SortableBindings = Parameters<Parameters<typeof SortableRow>[0]["children"]>[0]

function applyTreeMove(arcs: Tree["arcs"], move: TreeMove): Tree["arcs"] {
	const source = arcs as unknown as Arc[]
	return (move.kind === "arc"
		? moveArc(source, move.id, move.beforeId)
		: moveQuest(source, move.id, move.toArcId, move.beforeId)) as unknown as Tree["arcs"]
}
const quietClass =
	"min-h-11 font-cond text-sm hover:underline active:text-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"

export function SeasonTree({
	seasonId,
	tree,
	start,
	end,
	now,
	variant,
}: {
	seasonId: string
	tree: Tree
	start: Date | null
	end: Date | null
	now: number
	variant: Variant
}) {
	const router = useRouter()
	const autosave = useAutosave()
	const segments = useSelectedLayoutSegments()
	const editable = canEditStructure({ start, end }, new Date(useSeasonClock(now, start, end)))
	const [editing, setEditing] = useState<{ arcId: string; selectTitle: boolean } | null>(null)
	const [confirming, setConfirming] = useState<string | null>(null)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<{ control: string; message: string } | null>(null)
	const moves = useMoveQueue({ field: "arcs" }, tree.arcs, applyTreeMove, (target: TreeMove) =>
		target.kind === "arc"
			? saveArcMove({ seasonId, id: target.id, beforeId: target.beforeId })
			: saveQuestMove({ seasonId, id: target.id, toArcId: target.toArcId, beforeId: target.beforeId }),
	)
	const [drag, setDrag] = useState<"arc" | "quest" | null>(null)
	const [drop, setDrop] = useState<TreeMove | null>(null)
	const arcs = editable && drop ? applyTreeMove(moves.items, drop) : moves.items
	const folded = editable && drag === "arc"
	const keyboardArcs = moves.items as unknown as Arc[]
	const container = useRef<HTMLDivElement>(null)
	const [focusQuest, setFocusQuest] = useState<string | null>(null)
	useEffect(() => {
		if (!focusQuest) return
		const links = container.current?.querySelectorAll<HTMLAnchorElement>("a[href]")
		for (const link of links ?? []) {
			if (link.getAttribute("href") === `/admin/seasons/${seasonId}/quests/${focusQuest}`) link.focus()
		}
		setFocusQuest(null)
	}, [focusQuest, seasonId])
	function move(target: TreeMove) {
		if (!editable) return
		if (target.kind === "quest") setFocusQuest(target.id)
		void moves.move(target)
	}
	function dropTarget({ active, over }: Pick<DragOverEvent, "active" | "over">): TreeMove | null {
		if (!over || active.id === over.id) return null
		const id = String(active.id)
		const overId = String(over.id)
		const rect = active.rect.current.translated
		const after = !!rect && rect.top + rect.height / 2 > over.rect.top + over.rect.height / 2
		if (moves.items.some((arc) => arc.id === id)) {
			const remaining = moves.items.filter((arc) => arc.id !== id)
			const to = remaining.findIndex((arc) => arc.id === overId)
			return to < 0 ? null : { kind: "arc", id, beforeId: remaining[to + (after ? 1 : 0)]?.id ?? null }
		}
		const toArc = moves.items.find(
			(arc) => arc.quests.some((quest) => quest.id === overId) || `empty:${arc.id}` === overId,
		)
		if (!toArc) return null
		const remaining = toArc.quests.filter((quest) => quest.id !== id)
		const to = remaining.findIndex((quest) => quest.id === overId)
		return {
			kind: "quest",
			id,
			toArcId: toArc.id,
			beforeId: to < 0 ? null : (remaining[to + (after ? 1 : 0)]?.id ?? null),
		}
	}
	function finishDrag() {
		setDrag(null)
		setDrop(null)
		moves.setDragging(false)
	}
	function previewDrop(event: Pick<DragOverEvent, "active" | "over">) {
		const target = dropTarget(event)
		if (target) setDrop(target)
	}
	useEffect(() => {
		if (editable || !drag) return
		setDrag(null)
		setDrop(null)
		moves.setDragging(false)
	}, [editable, drag, moves.setDragging])
	const confirmedArc = tree.arcs.find((arc) => arc.id === confirming)
	const previousTree = useRef(tree)
	const discard = autosave?.discard
	const drafts = autosave?.drafts

	useEffect(() => {
		const previous = previousTree.current
		previousTree.current = tree
		if (!discard || !drafts || previous === tree) return
		for (const arc of previous.arcs) {
			for (const quest of arc.quests) {
				const destination = tree.arcs.find((current) => current.quests.some((current) => current.id === quest.id))
				if (!destination) discard({ arcId: arc.id, questId: quest.id })
				else if (destination.id !== arc.id) {
					for (const draft of drafts.values()) {
						if (draft.target.questId === quest.id) draft.target = { ...draft.target, arcId: destination.id }
					}
				}
			}
			if (!tree.arcs.some((current) => current.id === arc.id)) discard({ arcId: arc.id })
		}
	}, [tree, discard, drafts])

	async function run(control: string, action: () => Promise<ActionResult>) {
		if (pending || !editable) return
		setPending(true)
		setError(null)
		try {
			const result = await action()
			if (!result.ok) setError({ control, message: result.error })
		} catch {
			setError({ control, message: "Not saved, retry" })
		} finally {
			setPending(false)
		}
	}

	function deleteArc(arcId: string) {
		return run(`remove:${arcId}`, async () => {
			const result = await removeArc(seasonId, arcId)
			if (result.ok) {
				autosave?.discard({ arcId })
				setEditing(null)
				router.refresh()
			}
			return result
		})
	}

	const rows = (
		<ul>
			{arcs.map((arc) => (
				<ArcTree
					key={arc.id}
					arc={arc}
					seasonId={seasonId}
					variant={variant}
					selectedQuest={variant === "menu" && segments[0] === "quests" ? segments[1] : undefined}
					open={editing?.arcId === arc.id}
					selectTitle={editing?.arcId === arc.id && editing.selectTitle}
					onOpen={() => setEditing({ arcId: arc.id, selectTitle: false })}
					onClose={() => setEditing(null)}
					editable={editable}
					pending={pending}
					folded={folded}
					dragging={editable ? (drag ?? undefined) : undefined}
					keyboardArcs={keyboardArcs}
					onMove={move}
					addError={error?.control === `add:${arc.id}` ? error.message : undefined}
					removeError={error?.control === `remove:${arc.id}` ? error.message : undefined}
					onAdd={() =>
						void run(`add:${arc.id}`, async () => {
							const result = await addQuest(seasonId, arc.id)
							if (result.ok) router.push(`/admin/seasons/${seasonId}/quests/${result.questId}`)
							return result
						})
					}
					onRemove={() => (arc.quests.length ? setConfirming(arc.id) : void deleteArc(arc.id))}
				/>
			))}
		</ul>
	)
	const contents = (
		<>
			{editable ? (
				<SortableContext
					items={arcs.flatMap((arc) =>
						drag === "arc"
							? [arc.id]
							: drag === "quest"
								? arc.quests.map((quest) => quest.id)
								: [arc.id, ...arc.quests.map((quest) => quest.id)],
					)}
					strategy={verticalListSortingStrategy}
				>
					{rows}
				</SortableContext>
			) : (
				rows
			)}
			{!folded && (
				<div
					className={`${variant === "menu" ? "mx-3" : "px-4"} ${tree.arcs.length ? "mt-4 border-t border-z1" : "py-8"}`}
				>
					{!tree.arcs.length && <p className="mb-3 text-sm text-muted">No arcs yet.</p>}
					{editable && (
						<button
							type="button"
							className={`${quietClass} text-link`}
							disabled={pending}
							onClick={() =>
								void run("arc", async () => {
									const result = await addArc(seasonId)
									if (result.ok) {
										setEditing({ arcId: result.arcId, selectTitle: true })
										router.refresh()
									}
									return result
								})
							}
						>
							+ Arc
						</button>
					)}
					{error?.control === "arc" && (
						<p role="alert" className="font-cond text-xs text-warn">
							{error.message}
						</p>
					)}
				</div>
			)}
		</>
	)
	return (
		<div ref={container} className="pb-6 font-cond">
			{editable ? (
				<SortableDragLayer
					overlay={(active) => {
						const arc = moves.items.find((arc) => arc.id === active.id)
						const quest = moves.items.flatMap((arc) => arc.quests).find((quest) => quest.id === active.id)
						return arc ? (
							<ArcSummary arc={arc} />
						) : quest ? (
							<>
								<span className="min-w-0 flex-1 truncate">{quest.label ?? "Untitled quest"}</span>
								<span className="shrink-0 text-sm">{quest.points === null ? "–" : `${quest.points}p`}</span>
							</>
						) : null
					}}
					onDragStart={({ active }) => {
						setEditing(null)
						setDrag(moves.items.some((arc) => arc.id === active.id) ? "arc" : "quest")
						moves.setDragging(true)
					}}
					onDragOver={previewDrop}
					onDragEnd={(event) => {
						const target = drop ?? dropTarget(event)
						if (event.over && target) move(target)
						finishDrag()
					}}
					onDragCancel={finishDrag}
				>
					<TreeDragMonitor onMove={previewDrop} />
					{contents}
				</SortableDragLayer>
			) : (
				contents
			)}
			<ConfirmDialog
				open={!!confirmedArc}
				title={`Remove ${confirmedArc?.title.trim() || "Untitled arc"}?`}
				body={`This also removes ${confirmedArc?.quests.length === 1 ? "its quest" : `its ${confirmedArc?.quests.length ?? 0} quests`}.`}
				confirmLabel="Remove arc"
				disabled={pending || !editable}
				onConfirm={() => {
					if (confirmedArc) void deleteArc(confirmedArc.id)
				}}
				onClose={() => setConfirming(null)}
			/>
		</div>
	)
}

function ArcTree({
	arc,
	seasonId,
	variant,
	selectedQuest,
	open,
	selectTitle,
	onOpen,
	onClose,
	editable,
	pending,
	addError,
	removeError,
	onAdd,
	onRemove,
	folded,
	dragging,
	keyboardArcs,
	onMove,
}: {
	arc: Tree["arcs"][number]
	seasonId: string
	variant: Variant
	selectedQuest?: string
	open: boolean
	selectTitle: boolean
	onOpen: () => void
	onClose: () => void
	editable: boolean
	pending: boolean
	addError?: string
	removeError?: string
	onAdd: () => void
	onRemove: () => void
	folded: boolean
	dragging?: "arc" | "quest"
	keyboardArcs: Arc[]
	onMove: (move: TreeMove) => void
}) {
	const shuffle = useAutosaveField({ arcId: arc.id, field: "shuffleQuests" }, arc.shuffleQuests)
	const panel = useRef<HTMLFormElement>(null)
	useEffect(() => {
		if (!open) return
		const input = panel.current?.querySelector("input")
		input?.focus()
		if (selectTitle) input?.select()
	}, [open, selectTitle])
	const title = arc.title.trim() || "Untitled arc"
	const gutter = variant === "menu" ? "px-3" : "px-4"

	function content(bindings?: SortableBindings) {
		return (
			<section>
				{open ? (
					<form
						ref={panel}
						className={`mt-2 bg-z1 py-3 ${gutter}`}
						onSubmit={(event) => {
							event.preventDefault()
							onClose()
						}}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								event.preventDefault()
								onClose()
							}
						}}
					>
						<AutosaveTextField label="Arc title" target={{ arcId: arc.id, field: "title" }} serverValue={arc.title} />
						<div className="mt-3 flex items-center justify-between gap-2">
							{editable && (
								<button type="button" className={`${quietClass} text-muted`} disabled={pending} onClick={onRemove}>
									Remove arc
								</button>
							)}
							<button type="submit" className={`${outlineClass} ml-auto border-z2`}>
								Done
							</button>
						</div>
						{removeError && (
							<p role="alert" className="font-cond text-xs text-warn">
								{removeError}
							</p>
						)}
					</form>
				) : (
					<div className={`flex ${folded ? "h-11" : "min-h-14 pt-2"} items-center justify-between gap-2 ${gutter}`}>
						<button
							{...bindings}
							type="button"
							className={`min-h-11 min-w-0 ${folded ? "flex flex-1 items-center justify-between gap-3" : "truncate"} text-left text-xs uppercase tracking-wider text-muted hover:text-head active:text-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${bindings?.className ?? ""}`}
							aria-expanded={open}
							onClick={onOpen}
						>
							{folded ? <ArcSummary arc={{ ...arc, shuffleQuests: shuffle.value }} /> : title}
						</button>
						{!folded && (
							<div className="shrink-0">
								<button
									type="button"
									className={`${outlineClass} text-xs text-muted ${shuffle.failed ? "border-warn" : "border-z2"}`}
									aria-label={`Shuffle quests in ${title}`}
									aria-pressed={shuffle.value}
									aria-invalid={shuffle.failed}
									onClick={() => shuffle.onChange(!shuffle.value)}
									onFocus={shuffle.onFocus}
									onBlur={() => void shuffle.onBlur()}
								>
									{shuffle.value ? "Random" : "Ordered"}
								</button>
								{shuffle.failed && (
									<p role="alert" className="mt-1.5 font-cond text-xs text-warn">
										{shuffle.error ?? "Not saved"}
									</p>
								)}
							</div>
						)}
					</div>
				)}
				{!folded && (
					<ul>
						{arc.quests.map((quest) => (
							<QuestTreeRow
								key={quest.id}
								quest={quest}
								arcId={arc.id}
								editable={editable}
								keyboardArcs={keyboardArcs}
								onMove={onMove}
							>
								{(bindings) => (
									<Link
										{...bindings}
										role="link"
										href={`/admin/seasons/${seasonId}/quests/${quest.id}`}
										aria-current={selectedQuest === quest.id ? "page" : undefined}
										className={`flex h-11 items-center justify-between gap-3 ${gutter} hover:bg-z1/50 active:bg-z1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${bindings?.className ?? ""} ${variant === "page" ? "border-t border-z1 text-base" : "text-sm"} ${dragging ? "text-muted" : selectedQuest === quest.id ? "border-l-2 border-accent bg-accent/15 text-head" : "text-ink"}`}
									>
										<span className={`min-w-0 truncate${quest.label ? "" : " text-muted"}`}>
											{quest.label ?? "Untitled quest"}
										</span>
										<span
											className={`shrink-0 tabular-nums ${quest.points === null || variant === "menu" ? "text-xs text-muted" : dragging ? "text-sm text-muted" : "text-sm font-bold text-head"}`}
										>
											{quest.points === null ? "–" : `${quest.points}p`}
										</span>
									</Link>
								)}
							</QuestTreeRow>
						))}
						{editable && !arc.quests.length && <EmptyArcSlot arcId={arc.id} />}
					</ul>
				)}
				{editable && !folded && (
					<div className={`${gutter}${variant === "page" ? " border-t border-z1" : ""}`}>
						<button type="button" className={`${quietClass} text-link`} disabled={pending} onClick={onAdd}>
							{variant === "menu" ? "+ Quest" : `+ Quest in ${title}`}
						</button>
						{addError && (
							<p role="alert" className="font-cond text-xs text-warn">
								{addError}
							</p>
						)}
					</div>
				)}
			</section>
		)
	}
	return editable ? (
		<SortableRow
			id={arc.id}
			disabled={open || dragging === "quest"}
			keyboard={{
				arcs: keyboardArcs,
				item: { kind: "arc", id: arc.id },
				onMove: ({ beforeId }) => onMove({ kind: "arc", id: arc.id, beforeId }),
			}}
		>
			{content}
		</SortableRow>
	) : (
		<li>{content()}</li>
	)
}

function ArcSummary({ arc }: { arc: Tree["arcs"][number] }) {
	return (
		<>
			<span className="min-w-0 truncate">{arc.title.trim() || "Untitled arc"}</span>
			<span className="shrink-0 text-xs normal-case tracking-normal text-muted">
				{arc.quests.length ? `${arc.quests.length} ${arc.quests.length === 1 ? "quest" : "quests"}` : "No quests"} ·{" "}
				{arc.shuffleQuests ? "Random" : "Ordered"}
			</span>
		</>
	)
}

function QuestTreeRow({
	quest,
	arcId,
	editable,
	keyboardArcs,
	onMove,
	children,
}: {
	quest: Tree["arcs"][number]["quests"][number]
	arcId: string
	editable: boolean
	keyboardArcs: Arc[]
	onMove: (move: TreeMove) => void
	children: (bindings?: SortableBindings) => ReactNode
}) {
	return editable ? (
		<SortableRow
			id={quest.id}
			keyboard={{
				arcs: keyboardArcs,
				item: { kind: "quest", id: quest.id },
				onMove: ({ toArcId, beforeId }) => onMove({ kind: "quest", id: quest.id, toArcId: toArcId ?? arcId, beforeId }),
			}}
		>
			{children}
		</SortableRow>
	) : (
		<li>{children()}</li>
	)
}

function EmptyArcSlot({ arcId }: { arcId: string }) {
	const { setNodeRef } = useDroppable({ id: `empty:${arcId}` })
	return <li ref={setNodeRef} aria-hidden="true" className="h-11" />
}

function TreeDragMonitor({ onMove }: { onMove: (event: Pick<DragOverEvent, "active" | "over">) => void }) {
	useDndMonitor({ onDragMove: onMove })
	return null
}
