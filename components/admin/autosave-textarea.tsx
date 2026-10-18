"use client"

import { type ReactNode, useId, useLayoutEffect, useRef } from "react"
import { inputClass, labelClass } from "@/components/auth-form"
import { useAutosaveField } from "./autosave-provider"

export function AutosaveTextarea({
	label,
	target,
	serverValue,
	minRows,
	mono,
	missing,
}: {
	label: ReactNode
	target: Parameters<typeof useAutosaveField>[0]
	serverValue: string
	minRows: number
	mono: boolean
	missing?: string
}) {
	const field = useAutosaveField(target, serverValue)
	const id = useId()
	const ref = useRef<HTMLTextAreaElement>(null)
	useLayoutEffect(() => {
		const textarea = ref.current
		if (!textarea) return
		textarea.style.height = "auto"
		textarea.style.height = `${textarea.scrollHeight}px`
	})
	const style = inputClass.replace("h-11", "h-auto")
	const isMissing = !!missing && !field.value.trim()
	return (
		<div>
			<label htmlFor={id} className={labelClass}>
				{label}
			</label>
			<textarea
				ref={ref}
				id={id}
				rows={minRows}
				value={field.value}
				onChange={(event) => field.onChange(event.target.value)}
				onFocus={field.onFocus}
				onBlur={field.onBlur}
				aria-invalid={field.failed || undefined}
				aria-describedby={field.failed ? `${id}-error` : isMissing ? `${id}-missing` : undefined}
				className={`${field.failed || isMissing ? style.replaceAll("border-z2", "border-warn").replaceAll("focus:border-accent", "focus:border-warn") : style} min-h-11 resize-none overflow-hidden py-2 text-sm ${mono ? "font-mono" : "font-body"}`}
			/>
			{field.failed ? (
				<p id={`${id}-error`} role="alert" className="mt-1.5 font-cond text-xs text-warn">
					{field.error ?? "Not saved"}
				</p>
			) : isMissing ? (
				<p id={`${id}-missing`} className="mt-1.5 font-cond text-xs text-warn">
					{missing}
				</p>
			) : null}
		</div>
	)
}
