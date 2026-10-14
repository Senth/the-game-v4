"use client"

import { type KeyboardEvent, useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react"
import { inputClass, labelClass } from "@/components/auth-form"
import { worthWithAllHints } from "@/lib/domain/hints"
import type { Hint } from "@/lib/domain/schemas"
import { useAutosaveField } from "./autosave-provider"
import { primaryClass } from "./confirm-dialog"

export function HintsEditor({
	arcId,
	questId,
	points,
	hints,
}: {
	arcId: string
	questId: string
	points: number | null
	hints: Hint[]
}) {
	const questPoints = useAutosaveField({ arcId, questId, field: "points" }, points)
	const [openId, setOpenId] = useState<string | null>(null)
	const [penalties, setPenalties] = useState<Record<string, number>>({})
	const updatePenalty = useCallback((id: string, value: number) => {
		setPenalties((current) => (Object.is(current[id], value) ? current : { ...current, [id]: value }))
	}, [])
	const total = worthWithAllHints(
		questPoints.value,
		hints.map((hint) => penalties[hint.id] ?? hint.points),
	)
	const worth = total !== null && Number.isFinite(total) ? total : null
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
				{hints.map((hint) => (
					<HintRow
						key={hint.id}
						arcId={arcId}
						questId={questId}
						hint={hint}
						open={openId === hint.id}
						onOpen={() => setOpenId(hint.id)}
						onClose={() => setOpenId(null)}
						onPointsChange={updatePenalty}
					/>
				))}
			</ul>
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
}: {
	arcId: string
	questId: string
	hint: Hint
	open: boolean
	onOpen: () => void
	onClose: () => void
	onPointsChange: (id: string, value: number) => void
}) {
	const text = useAutosaveField({ arcId, questId, hintId: hint.id, field: "text" }, hint.text)
	const points = useAutosaveField({ arcId, questId, hintId: hint.id, field: "points" }, hint.points)
	const id = useId()
	const textarea = useRef<HTMLTextAreaElement>(null)
	const button = useRef<HTMLButtonElement>(null)
	const returnFocus = useRef(false)
	const finishEditing = useEffectEvent(() => {
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
							disabled
							className="ml-auto min-h-11 px-3 font-cond text-sm text-muted disabled:opacity-60"
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
		</li>
	)
}
