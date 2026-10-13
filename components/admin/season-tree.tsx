"use client"

import Link from "next/link"
import { useRouter, useSelectedLayoutSegments } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import type { ActionResult } from "@/app/admin/action-result"
import { addArc, addQuest, removeArc } from "@/app/admin/tree-actions"
import { canEditStructure, type treeView } from "@/lib/domain/season-tree"
import { useAutosaveField } from "./autosave-provider"
import { AutosaveTextField } from "./autosave-text-field"
import { ConfirmDialog, outlineClass } from "./confirm-dialog"
import { useSeasonClock } from "./use-season-clock"

type Tree = ReturnType<typeof treeView>
type Variant = "menu" | "page"
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
	const segments = useSelectedLayoutSegments()
	const editable = canEditStructure({ start, end }, new Date(useSeasonClock(now, start, end)))
	const [editing, setEditing] = useState<{ arcId: string; selectTitle: boolean } | null>(null)
	const [confirming, setConfirming] = useState<string | null>(null)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<{ control: string; message: string } | null>(null)
	const confirmedArc = tree.arcs.find((arc) => arc.id === confirming)

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
				setEditing(null)
				router.refresh()
			}
			return result
		})
	}

	return (
		<div className="pb-6 font-cond">
			{tree.arcs.map((arc) => (
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
				<div className={`flex min-h-14 items-center justify-between gap-2 pt-2 ${gutter}`}>
					<button
						type="button"
						className="min-h-11 min-w-0 truncate text-left text-xs uppercase tracking-wider text-muted hover:text-head active:text-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
						aria-expanded={open}
						onClick={onOpen}
					>
						{title}
					</button>
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
				</div>
			)}
			<ul>
				{arc.quests.map((quest) => (
					<li key={quest.id}>
						<Link
							href={`/admin/seasons/${seasonId}/quests/${quest.id}`}
							aria-current={selectedQuest === quest.id ? "page" : undefined}
							className={`flex h-11 items-center justify-between gap-3 ${gutter} hover:bg-z1/50 active:bg-z1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${variant === "page" ? "border-t border-z1 text-base" : "text-sm"} ${selectedQuest === quest.id ? "border-l-2 border-accent bg-accent/15 text-head" : "text-ink"}`}
						>
							<span className={`min-w-0 truncate${quest.label ? "" : " text-muted"}`}>
								{quest.label ?? "Untitled quest"}
							</span>
							<span
								className={`shrink-0 tabular-nums ${quest.points === null || variant === "menu" ? "text-xs text-muted" : "text-sm font-bold text-head"}`}
							>
								{quest.points === null ? "–" : `${quest.points}p`}
							</span>
						</Link>
					</li>
				))}
			</ul>
			{editable && (
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
