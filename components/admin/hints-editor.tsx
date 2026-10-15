"use client"

import { type KeyboardEvent, useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react"
import { inputClass, labelClass } from "@/components/auth-form"
import { worthWithAllHints } from "@/lib/domain/hints"
import { Hint } from "@/lib/domain/schemas"
import { useAutosave, useAutosaveField, useAutosaveList } from "./autosave-provider"
import { ConfirmDialog, primaryClass } from "./confirm-dialog"
import { useSeasonClock } from "./use-season-clock"

export function HintsEditor({
	arcId,
	questId,
	points,
	hints,
	revealers,
	start,
	end,
	now,
}: {
	arcId: string
	questId: string
	points: number | null
	hints: Hint[]
	revealers: Record<string, string[]>
	start: Date | null
	end: Date | null
	now: number
}) {
	const currentNow = useSeasonClock(now, start, end)
	const hasStarted = start !== null && start.getTime() <= currentNow
	const autosave = useAutosave()
	const list = useAutosaveList({ arcId, questId, field: "hints" }, hints)
	const questPoints = useAutosaveField({ arcId, questId, field: "points" }, points)
	const [openId, setOpenId] = useState<string | null>(null)
	const [newHint, setNewHint] = useState<Hint | null>(null)
	const [confirming, setConfirming] = useState<{ id: string; points: number } | null>(null)
	const items = newHint && !list.items.some((hint) => hint.id === newHint.id) ? [...list.items, newHint] : list.items
	const count = confirming ? (revealers[confirming.id]?.length ?? 0) : 0
	const [penalties, setPenalties] = useState<Record<string, number>>({})
	const updatePenalty = useCallback((id: string, value: number) => {
		setPenalties((current) => (Object.is(current[id], value) ? current : { ...current, [id]: value }))
	}, [])
	const total = worthWithAllHints(
		questPoints.value,
		items.map((hint) => penalties[hint.id] ?? hint.points),
	)
	const worth = total !== null && Number.isFinite(total) ? total : null
	function remove(id: string) {
		autosave?.discard({ arcId, questId, hintId: id })
		if (list.items.some((hint) => hint.id === id)) list.remove(id)
		if (newHint?.id === id) setNewHint(null)
		if (openId === id) setOpenId(null)
	}
	return (
		<section aria-label="Hints" className="pt-3">
			<div className="flex items-end justify-between gap-3 border-b border-z2 pb-2">
				<h3 className={labelClass.replace("mb-1.5 ", "")}>Hints</h3>
				<p className="font-cond text-sm text-muted">
					Worth with all hints:{" "}
					<b className={worth === null ? "text-muted" : "text-head tabular-nums"}>
						{worth === null ? "–" : `${worth < 0 ? "−" : ""}${Math.abs(worth)}p`}
					</b>
				</p>
			</div>
			<ul>
				{items.map((hint) => (
					<HintRow
						key={hint.id}
						arcId={arcId}
						questId={questId}
						hint={hint}
						open={openId === hint.id}
						onOpen={() => setOpenId(hint.id)}
						onClose={() => setOpenId(null)}
						onPointsChange={updatePenalty}
						revealerNames={hasStarted ? (revealers[hint.id] ?? []) : null}
						create={hint.id === newHint?.id ? list.add : undefined}
						onCreated={() => setNewHint((current) => (current?.id === hint.id ? null : current))}
						onDiscard={() => remove(hint.id)}
						onRemove={(penalty) => {
							if (revealers[hint.id]?.length) setConfirming({ id: hint.id, points: penalty })
							else remove(hint.id)
						}}
					/>
				))}
			</ul>
			<button
				type="button"
				className="mt-3 min-h-11 w-full rounded-md border border-dashed border-z2 px-4 font-cond text-sm text-link hover:bg-z1/50 active:bg-z1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
				onClick={() => {
					const hint = { id: crypto.randomUUID(), text: "", points: 5 }
					setNewHint(hint)
					setOpenId(hint.id)
				}}
			>
				+ Add hint
			</button>
			{list.failed && (
				<p role="alert" className="mt-1.5 font-cond text-xs text-warn">
					Not saved
				</p>
			)}
			<ConfirmDialog
				open={confirming !== null}
				title="Remove this hint?"
				body={`${count} ${count === 1 ? "team revealed it. It keeps" : "teams revealed it. They keep"} its −${confirming?.points ?? 0}p penalty.`}
				confirmLabel="Remove hint"
				onConfirm={() => {
					if (confirming) remove(confirming.id)
					setConfirming(null)
				}}
				onClose={() => setConfirming(null)}
			/>
		</section>
	)
}

function HintRow({
	arcId,
	questId,
	hint,
	open,
	onOpen,
	onClose,
	onPointsChange,
	create,
	onCreated,
	onDiscard,
	onRemove,
	revealerNames,
}: {
	arcId: string
	questId: string
	hint: Hint
	open: boolean
	onOpen: () => void
	onClose: () => void
	onPointsChange: (id: string, value: number) => void
	create?: (hint: Hint) => Promise<boolean>
	onCreated: () => void
	onDiscard: () => void
	onRemove: (points: number) => void
	revealerNames: string[] | null
}) {
	const savedText = useAutosaveField({ arcId, questId, hintId: hint.id, field: "text" }, hint.text)
	const savedPoints = useAutosaveField({ arcId, questId, hintId: hint.id, field: "points" }, hint.points)
	const [created, setCreated] = useState(!create)
	const [local, setLocal] = useState(hint)
	const draft = useRef(hint)
	const adding = useRef(false)
	const removed = useRef(false)
	function edit(next: Hint) {
		if (adding.current) {
			if (next.text !== draft.current.text) savedText.onChange(next.text)
			if (next.points !== draft.current.points) savedPoints.onChange(next.points)
		}
		draft.current = next
		setLocal(next)
	}
	const invalid = !created && !Hint.shape.points.safeParse(local.points).success
	async function saveNew() {
		if (
			!create ||
			created ||
			adding.current ||
			removed.current ||
			!draft.current.text.trim() ||
			!Hint.shape.points.safeParse(draft.current.points).success
		)
			return
		adding.current = true
		const added = draft.current
		if (!(await create(added)) || removed.current) return
		setCreated(true)
		onCreated()
	}
	const saveNewOnIdle = useEffectEvent(saveNew)
	useEffect(() => {
		removed.current = false
		return () => {
			removed.current = true
		}
	}, [])
	useEffect(() => {
		if (created || !local.text.trim() || !Hint.shape.points.safeParse(local.points).success) return
		const timer = setTimeout(() => void saveNewOnIdle(), 500)
		return () => clearTimeout(timer)
	}, [created, local])
	const text = created
		? savedText
		: {
				...savedText,
				value: local.text,
				onChange: (value: string) => edit({ ...draft.current, text: value }),
				onFocus: () => {},
				onBlur: () => (adding.current ? savedText.onBlur() : void saveNew()),
			}
	const points = created
		? savedPoints
		: {
				...savedPoints,
				value: local.points,
				onChange: (value: number) => edit({ ...draft.current, points: value }),
				onFocus: () => {},
				onBlur: () => (adding.current ? savedPoints.onBlur() : void saveNew()),
				failed: invalid,
				error: invalid ? "Use a whole number from 0 to 10000." : undefined,
			}
	const id = useId()
	const textarea = useRef<HTMLTextAreaElement>(null)
	const button = useRef<HTMLButtonElement>(null)
	const returnFocus = useRef(false)
	const finishEditing = useEffectEvent(() => {
		if (removed.current) return
		if (!created && !adding.current && !draft.current.text.trim()) {
			if (!open) onDiscard()
			return
		}
		void text.onBlur()
		void points.onBlur()
	})
	useEffect(() => onPointsChange(hint.id, points.value), [hint.id, points.value, onPointsChange])
	useEffect(() => {
		if (open) {
			textarea.current?.focus()
			return () => finishEditing()
		}
		if (returnFocus.current) {
			button.current?.focus()
			returnFocus.current = false
		}
	}, [open])
	function close() {
		if (!created && !adding.current && !draft.current.text.trim()) {
			onDiscard()
			return
		}
		returnFocus.current = true
		onClose()
	}
	function onKeyDown(event: KeyboardEvent) {
		if (event.nativeEvent.isComposing || (event.key !== "Enter" && event.key !== "Escape")) return
		event.preventDefault()
		close()
	}
	return (
		<li className="border-b border-z1">
			{open ? (
				<form
					aria-label="Edit hint"
					className="space-y-3 py-3"
					onKeyDown={onKeyDown}
					onSubmit={(event) => {
						event.preventDefault()
						close()
					}}
				>
					<textarea
						ref={textarea}
						aria-label="Hint text"
						rows={3}
						value={text.value}
						onChange={(event) => text.onChange(event.target.value)}
						onFocus={text.onFocus}
						onBlur={text.onBlur}
						aria-invalid={text.failed}
						aria-describedby={text.failed ? `${id}-text-error` : undefined}
						className={`w-full rounded-md border ${text.failed ? "border-warn" : "border-accent"} bg-field px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent`}
					/>
					{text.failed && (
						<p id={`${id}-text-error`} role="alert" className="font-cond text-xs text-warn">
							{text.error ?? "Not saved"}
						</p>
					)}
					<div className="flex items-center gap-2">
						<input
							aria-label="Hint points"
							type="number"
							inputMode="numeric"
							step={1}
							min={0}
							max={10000}
							value={Number.isNaN(points.value) ? "" : points.value}
							onChange={(event) => points.onChange(event.target.valueAsNumber)}
							onFocus={points.onFocus}
							onBlur={points.onBlur}
							aria-invalid={points.failed}
							aria-describedby={points.failed ? `${id}-points-error` : undefined}
							className={`${inputClass
								.replace("w-full", "w-16")
								.replace("px-3", "px-2")
								.replaceAll("border-z2", points.failed ? "border-warn" : "border-z2")
								.replace(
									"focus:border-accent",
									points.failed ? "focus:border-warn" : "focus:border-accent",
								)} text-right text-sm tabular-nums`}
						/>
						<span className="text-xs text-muted">p</span>
						<button
							type="button"
							className="ml-auto min-h-11 px-3 font-cond text-sm text-muted hover:underline active:text-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
							onClick={() => onRemove(points.value)}
						>
							Remove
						</button>
						<button type="button" className={primaryClass} onClick={close}>
							Done
						</button>
					</div>
					{points.failed && (
						<p id={`${id}-points-error`} role="alert" className="font-cond text-xs text-warn">
							{points.error ?? "Not saved"}
						</p>
					)}
				</form>
			) : (
				<button
					ref={button}
					type="button"
					className="flex min-h-11 w-full items-center gap-3 py-2.5 text-left hover:bg-z1/50 active:bg-z1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
					onClick={onOpen}
				>
					<span className={`min-w-0 flex-1 truncate text-sm ${text.value ? "text-ink" : "text-muted"}`}>
						{text.value || "Empty hint"}
					</span>
					<span className="shrink-0 font-cond text-sm text-muted tabular-nums">−{points.value}p</span>
				</button>
			)}
			{revealerNames !== null && (
				<div className="pb-2.5">
					{revealerNames.length ? (
						<div className="flex flex-wrap items-center gap-1.5">
							<span className="mr-1 font-cond text-xs text-muted">Revealed by</span>
							{revealerNames.map((name) => (
								<span
									key={name}
									className="inline-flex min-h-6 max-w-full items-center rounded bg-z2 px-2 font-cond text-xs text-ink break-all"
								>
									{name}
								</span>
							))}
						</div>
					) : (
						<p className="font-cond text-xs text-muted">Not revealed yet</p>
					)}
				</div>
			)}
		</li>
	)
}
