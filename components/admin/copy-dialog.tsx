"use client"

import { useEffect, useState } from "react"
import { copyArc, getCopyDestinations } from "@/app/admin/copy-actions"
import { formatSeasonDay } from "@/lib/domain/admin-seasons"
import { ConfirmDialog } from "./confirm-dialog"

type Destination = Extract<Awaited<ReturnType<typeof getCopyDestinations>>, { ok: true }>["destinations"][number]
type SourceArc = { id: string; title: string; hintCount?: number; quests: { id: string }[] }

export function CopyDialog({
	open,
	sourceSeasonId,
	sourceSeasonTitle,
	arc,
	onClose,
}: {
	open: boolean
	sourceSeasonId: string
	sourceSeasonTitle: string
	arc: SourceArc
	onClose: () => void
}) {
	const [destinations, setDestinations] = useState<Destination[] | null>(null)
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [copiedTo, setCopiedTo] = useState<Destination | null>(null)
	useEffect(() => {
		if (!open) return
		let current = true
		setDestinations(null)
		setSelectedId(null)
		setPending(false)
		setError(null)
		setCopiedTo(null)
		void getCopyDestinations(sourceSeasonId)
			.then((result) => {
				if (!current) return
				if (!result.ok) {
					setError(result.error)
					return
				}
				setDestinations(result.destinations)
				setSelectedId(result.destinations[0]?.id ?? null)
			})
			.catch(() => {
				if (current) setError("Not saved, retry")
			})
		return () => {
			current = false
		}
	}, [open, sourceSeasonId])

	const selected = destinations?.find((destination) => destination.id === selectedId)
	const arcTitle = arc.title.trim() || "Untitled arc"
	const hintCount = arc.hintCount ?? 0
	const title = copiedTo ? `Copied to ${copiedTo.title}` : `Copy ${arcTitle}`
	const body = copiedTo ? (
		`${arcTitle} is now the last arc there, with ${arc.quests.length} new ${arc.quests.length === 1 ? "quest" : "quests"}.`
	) : (
		<div>
			<p className="font-cond text-sm text-muted">
				From {sourceSeasonTitle} · {arc.quests.length} {arc.quests.length === 1 ? "quest" : "quests"} · {hintCount}{" "}
				{hintCount === 1 ? "hint" : "hints"}
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
										name={`copy-arc-${arc.id}`}
										value={destination.id}
										checked={selectedId === destination.id}
										className="size-4 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
	)

	async function submit() {
		if (!selected || pending) return
		setPending(true)
		setError(null)
		try {
			const result = await copyArc(sourceSeasonId, arc.id, selected.id)
			if (!result.ok) setError(result.error)
			else setCopiedTo(selected)
		} catch {
			setError("Not saved, retry")
		} finally {
			setPending(false)
		}
	}

	const empty = destinations !== null && destinations.length === 0
	return (
		<ConfirmDialog
			open={open}
			title={title}
			body={body}
			cancelLabel={copiedTo || empty ? "Close" : undefined}
			confirmLabel={copiedTo || empty ? undefined : "Copy arc"}
			confirmTone="accent"
			disabled={pending || !selected}
			closeOnConfirm={false}
			error={error}
			result={copiedTo ? { label: "Open it ›", href: `/admin/seasons/${copiedTo.id}` } : undefined}
			onConfirm={() => void submit()}
			onClose={onClose}
		/>
	)
}
