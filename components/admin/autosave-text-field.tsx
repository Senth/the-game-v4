"use client"

import { useId } from "react"
import { inputClass, labelClass } from "@/components/auth-form"
import { useAutosaveField } from "./autosave-provider"

export function AutosaveTextField({
	label,
	target,
	serverValue,
}: {
	label: string
	target: Parameters<typeof useAutosaveField>[0]
	serverValue: string
}) {
	const id = useId()
	const field = useAutosaveField(target, serverValue)
	return (
		<div>
			<label htmlFor={id} className={labelClass}>
				{label}
			</label>
			<input
				id={id}
				type="text"
				value={field.value}
				onChange={(event) => field.onChange(event.target.value)}
				onFocus={field.onFocus}
				onBlur={field.onBlur}
				aria-invalid={field.failed}
				aria-describedby={field.failed ? `${id}-error` : undefined}
				className={`${field.failed ? inputClass.replaceAll("border-z2", "border-warn").replaceAll("focus:border-accent", "focus:border-warn") : inputClass} text-sm`}
			/>
			{field.failed && (
				<p id={`${id}-error`} role="alert" className="mt-1.5 font-cond text-xs text-warn">
					Not saved
				</p>
			)}
		</div>
	)
}
