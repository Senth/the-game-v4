"use client"

import { useId, useState } from "react"
import { inputClass, labelClass } from "@/components/auth-form"
import { normalizeAnswer } from "@/lib/domain/game"
import { useAutosaveList } from "./autosave-provider"

export function AnswerChips({ arcId, questId, answers }: { arcId: string; questId: string; answers: string[] }) {
	const list = useAutosaveList({ arcId, questId, field: "answers" }, answers)
	const [text, setText] = useState("")
	const [duplicate, setDuplicate] = useState(false)
	const id = useId()
	function commit(parts: string[]) {
		const existing = new Set(list.items.map(normalizeAnswer))
		let foundDuplicate = false
		for (const part of parts) {
			const answer = part.normalize("NFC").trim()
			if (!answer) continue
			const normalized = normalizeAnswer(answer)
			if (existing.has(normalized)) foundDuplicate = true
			else {
				existing.add(normalized)
				list.add(answer)
			}
		}
		setText("")
		setDuplicate(foundDuplicate)
	}
	const style = inputClass.replace("h-11", "min-h-11").replace("px-3", "p-2").replace("focus:", "focus-within:")
	return (
		<div>
			<label htmlFor={id} className={labelClass}>
				Answers <span className="ml-2 font-body normal-case tracking-normal">any match, case-insensitive</span>
			</label>
			<div
				className={`${list.failed ? style.replaceAll("border-z2", "border-warn").replaceAll("focus-within:border-accent", "focus-within:border-warn") : style} flex flex-wrap items-center gap-2`}
			>
				{list.items.map((answer) => (
					<span key={answer} className="inline-flex min-w-0 items-center rounded bg-z2 pl-2 font-cond text-sm">
						<span className="break-all">{answer}</span>
						<button
							type="button"
							aria-label={`Remove answer ${answer}`}
							onClick={() => list.remove(answer)}
							className="min-h-11 w-11 shrink-0 rounded text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-link active:text-head"
						>
							✕
						</button>
					</span>
				))}
				<input
					id={id}
					value={text}
					placeholder="Add answer"
					maxLength={200}
					aria-invalid={list.failed}
					aria-describedby={list.failed ? `${id}-error` : duplicate ? `${id}-duplicate` : undefined}
					className="min-h-11 w-20 min-w-0 flex-1 bg-field font-cond text-sm outline-hidden placeholder:text-muted"
					onChange={(event) => {
						setDuplicate(false)
						const parts = event.target.value.split(",")
						const remaining = parts.pop() ?? ""
						if (parts.length) commit(parts)
						setText(remaining)
					}}
					onKeyDown={(event) => {
						setDuplicate(false)
						if (event.nativeEvent.isComposing) return
						if (event.key === "Enter" || event.key === ",") {
							event.preventDefault()
							commit([text])
						} else if (event.key === "Backspace" && !text) {
							const last = list.items.at(-1)
							if (last !== undefined) {
								event.preventDefault()
								list.remove(last)
							}
						}
					}}
					onPaste={(event) => {
						event.preventDefault()
						const input = event.currentTarget
						const pasted =
							text.slice(0, input.selectionStart ?? text.length) +
							event.clipboardData.getData("text") +
							text.slice(input.selectionEnd ?? text.length)
						commit(pasted.split(/[,\r\n]/))
					}}
					onBlur={() => {
						if (text) commit([text])
					}}
				/>
			</div>
			{list.failed && (
				<p id={`${id}-error`} role="alert" className="mt-1.5 font-cond text-xs text-warn">
					Not saved
				</p>
			)}
			{duplicate && (
				<p id={`${id}-duplicate`} role="status" className="mt-1.5 font-cond text-xs text-muted">
					Already an answer
				</p>
			)}
		</div>
	)
}
