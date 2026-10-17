"use client"

import { useEffect, useRef, useState } from "react"
import { copyArc, copyQuest, getCopyDestinations } from "@/app/admin/copy-actions"
import { formatSeasonDay } from "@/lib/domain/admin-seasons"
import { ConfirmDialog } from "./confirm-dialog"

type Destination = Extract<Awaited<ReturnType<typeof getCopyDestinations>>, { ok: true }>["destinations"][number]
type SourceArc = { id: string; title: string; hintCount?: number; quests: { id: string }[] }
type CopyDialogProps = {
	open: boolean
	sourceSeasonId: string
	sourceSeasonTitle: string
	onClose: () => void
} & (
	| { mode: "arc"; arc: SourceArc }
	| { mode: "quest"; quest: { id: string; label: string; hintCount: number }; sourceArc: { id: string; title: string } }
)
type QuestTarget = { seasonId: string; arcId: string | null }

export function CopyDialog(props: CopyDialogProps) {
	const { open, sourceSeasonId, sourceSeasonTitle, onClose } = props
	const [destinations, setDestinations] = useState<Destination[] | null>(null)
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [questTarget, setQuestTarget] = useState<QuestTarget | null>(null)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [copiedTo, setCopiedTo] = useState<Destination | null>(null)
	const [copiedQuestId, setCopiedQuestId] = useState<string | null>(null)
	const [copiedQuestArc, setCopiedQuestArc] = useState<string | null>(null)
	const requestToken = useRef(0)
	useEffect(() => {
		if (!open) return
		const token = ++requestToken.current
		setDestinations(null)
		setSelectedId(null)
		setQuestTarget(null)
		setPending(false)
		setError(null)
		setCopiedTo(null)
		setCopiedQuestId(null)
		setCopiedQuestArc(null)
		void getCopyDestinations(sourceSeasonId)
			.then((result) => {
				if (token !== requestToken.current) return
				if (!result.ok) {
					setError(result.error)
					return
				}
				setDestinations(result.destinations)
				setSelectedId(result.destinations[0]?.id ?? null)
				const first = result.destinations[0]
				setQuestTarget(first ? { seasonId: first.id, arcId: first.arcs[0]?.id ?? null } : null)
			})
			.catch(() => {
				if (token === requestToken.current) setError("Not saved, retry")
			})
		return () => {
			if (token === requestToken.current) requestToken.current += 1
		}
	}, [open, sourceSeasonId])

	const selected =
		props.mode === "arc"
			? destinations?.find((destination) => destination.id === selectedId)
			: destinations?.find((destination) => destination.id === questTarget?.seasonId)
	const selectedQuestArc =
		props.mode === "quest" && selected && questTarget
			? questTarget.arcId === null
				? props.sourceArc.title
				: selected.arcs.find((arc) => arc.id === questTarget.arcId)?.title
			: undefined
	const canSubmit =
		props.mode === "arc" ||
		Boolean(
			questTarget &&
				selected &&
				(questTarget.arcId === null || selected.arcs.some((arc) => arc.id === questTarget.arcId)),
		)
	const sourceArcTitle =
		props.mode === "arc" ? props.arc.title.trim() || "Untitled arc" : props.sourceArc.title.trim() || "Untitled arc"
	const label = props.mode === "arc" ? sourceArcTitle : props.quest.label
	const hintCount = props.mode === "arc" ? (props.arc.hintCount ?? 0) : props.quest.hintCount
	const title = copiedTo ? `Copied to ${copiedTo.title}` : `Copy ${label}`
	const body = copiedTo ? (
		props.mode === "arc" ? (
			`${label} is now the last arc there, with ${props.arc.quests.length} new ${props.arc.quests.length === 1 ? "quest" : "quests"}.`
		) : (
			`${label} is now the last quest in ${copiedQuestArc ?? sourceArcTitle}.`
		)
	) : props.mode === "arc" ? (
		<div>
			<p className="font-cond text-sm text-muted">
				From {sourceSeasonTitle} · {props.arc.quests.length} {props.arc.quests.length === 1 ? "quest" : "quests"} ·{" "}
				{hintCount} {hintCount === 1 ? "hint" : "hints"}
			</p>
			<div className="mt-3">
				<p className="font-cond text-sm text-muted">To season</p>
				{destinations === null && !error ? (
					<p className="mt-2 font-cond text-xs text-muted">Finding seasons…</p>
				) : destinations?.length === 0 && !error ? (
					<p className="mt-2 font-cond text-xs text-muted">No season is waiting to start. Create one first.</p>
				) : (
					destinations && (
						<div className="mt-2 space-y-1">
							{destinations.map((destination) => (
								<label
									key={destination.id}
									className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-3 text-sm ${selectedId === destination.id ? "bg-accent/15 text-head" : "text-ink"}`}
								>
									<input
										type="radio"
										name={`copy-arc-${props.arc.id}`}
										value={destination.id}
										checked={selectedId === destination.id}
										className="size-4 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
										disabled={pending}
										onChange={() => setSelectedId(destination.id)}
									/>
									<span className="min-w-0 flex-1">
										{destination.title}
										<span className="block font-cond text-xs text-muted">
											{destination.status === "upcoming" && destination.start
												? `Upcoming · ${formatSeasonDay(destination.start)}`
												: "Not started"}
										</span>
									</span>
								</label>
							))}
						</div>
					)
				)}
			</div>
			{destinations?.length ? (
				<p className="mt-3 font-cond text-xs text-muted">
					The copy gets its own quests. Editing one season never changes the other.
				</p>
			) : null}
		</div>
	) : (
		<div>
			<p className="font-cond text-sm text-muted">
				From {sourceSeasonTitle} · {sourceArcTitle} · {hintCount} {hintCount === 1 ? "hint" : "hints"}
			</p>
			<div className="mt-3">
				<p className="font-cond text-sm text-muted">Into arc</p>
				{destinations === null && !error ? (
					<p className="mt-2 font-cond text-xs text-muted">Finding seasons…</p>
				) : destinations?.length === 0 && !error ? (
					<p className="mt-2 font-cond text-xs text-muted">No season is waiting to start. Create one first.</p>
				) : (
					destinations && (
						<div className="mt-2 space-y-2">
							{destinations.map((destination) => (
								<section key={destination.id}>
									<div className="flex items-center justify-between gap-3 px-3 py-2">
										<span className="font-cond text-sm text-head">{destination.title}</span>
										<span className="shrink-0 font-cond text-xs text-muted">
											{destination.status === "upcoming" && destination.start
												? `Upcoming · ${formatSeasonDay(destination.start)}`
												: "Not started"}
										</span>
									</div>
									<div className="space-y-1">
										{destination.arcs.map((arc) => {
											const checked = questTarget?.seasonId === destination.id && questTarget.arcId === arc.id
											return (
												<label
													key={arc.id}
													className={`ml-3 flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-3 text-sm ${checked ? "bg-accent/15 text-head" : "text-ink"}`}
												>
													<input
														type="radio"
														name={`copy-quest-${props.quest.id}`}
														value={arc.id}
														checked={checked}
														className="size-4 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
														disabled={pending}
														onChange={() => setQuestTarget({ seasonId: destination.id, arcId: arc.id })}
													/>
													<span className="min-w-0 flex-1">{arc.title}</span>
												</label>
											)
										})}
										<label
											className={`ml-3 flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-3 text-sm ${questTarget?.seasonId === destination.id && questTarget.arcId === null ? "bg-accent/15 text-head" : "text-ink"}`}
										>
											<input
												type="radio"
												name={`copy-quest-${props.quest.id}`}
												value={`new:${destination.id}`}
												checked={questTarget?.seasonId === destination.id && questTarget.arcId === null}
												className="size-4 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
												disabled={pending}
												onChange={() => setQuestTarget({ seasonId: destination.id, arcId: null })}
											/>
											<span className="min-w-0 flex-1">
												<span className="text-link">New arc</span>{" "}
												<span className="text-muted">“{sourceArcTitle}”</span>
											</span>
										</label>
									</div>
								</section>
							))}
						</div>
					)
				)}
			</div>
			{destinations?.length ? (
				<p className="mt-3 font-cond text-xs text-muted">
					The copy is a new quest. Editing one season never changes the other.
				</p>
			) : null}
		</div>
	)

	async function submit() {
		if (!selected || !canSubmit || pending) return
		const token = requestToken.current
		const submittedDestination = selected
		const submittedQuestArc = selectedQuestArc ?? sourceArcTitle
		setPending(true)
		setError(null)
		try {
			if (props.mode === "arc") {
				const result = await copyArc(sourceSeasonId, props.arc.id, selected.id)
				if (token !== requestToken.current) return
				if (!result.ok) setError(result.error)
				else setCopiedTo(submittedDestination)
			} else {
				if (!questTarget) return
				const result = await copyQuest(
					sourceSeasonId,
					props.quest.id,
					questTarget.arcId === null
						? { seasonId: questTarget.seasonId, newArc: true }
						: { seasonId: questTarget.seasonId, arcId: questTarget.arcId },
				)
				if (token !== requestToken.current) return
				if (!result.ok) setError(result.error)
				else {
					setCopiedTo(submittedDestination)
					setCopiedQuestId(result.questId)
					setCopiedQuestArc(submittedQuestArc)
				}
			}
		} catch {
			if (token === requestToken.current) setError("Not saved, retry")
		} finally {
			if (token === requestToken.current) setPending(false)
		}
	}

	function close() {
		requestToken.current += 1
		onClose()
	}

	const empty = destinations !== null && destinations.length === 0
	return (
		<ConfirmDialog
			open={open}
			title={title}
			body={body}
			cancelLabel={copiedTo || empty ? "Close" : undefined}
			confirmLabel={copiedTo || empty ? undefined : props.mode === "arc" ? "Copy arc" : "Copy quest"}
			confirmTone="accent"
			disabled={pending || !selected || !canSubmit}
			closeOnConfirm={false}
			error={error}
			result={
				copiedTo
					? {
							label: "Open it ›",
							href:
								props.mode === "arc"
									? `/admin/seasons/${copiedTo.id}`
									: `/admin/seasons/${copiedTo.id}/quests/${copiedQuestId}`,
						}
					: undefined
			}
			onConfirm={() => void submit()}
			onClose={close}
		/>
	)
}
