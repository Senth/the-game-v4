"use client"

import { type ComponentProps, type ReactNode, useId } from "react"
import { inputClass, labelClass } from "@/components/auth-form"
import { useAutosaveField } from "./autosave-provider"

export function AutosaveTextField({
	label,
	target,
	serverValue,
	autoFocus,
}: {
	label: ReactNode
	target: Parameters<typeof useAutosaveField>[0]
	serverValue: string
	autoFocus?: boolean
}) {
	const field = useAutosaveField(target, serverValue)
	return (
		<AutosaveInput
			label={label}
			autoFocus={autoFocus}
			type="text"
			value={field.value}
			onChange={(event) => field.onChange(event.target.value)}
			onFocus={field.onFocus}
			onBlur={field.onBlur}
			failed={field.failed}
			error={field.error}
		/>
	)
}

export function AutosaveInput({
	label,
	failed,
	error,
	helper,
	suffix,
	children,
	...input
}: Omit<ComponentProps<"input">, "id" | "className" | "children"> & {
	label: ReactNode
	failed: boolean
	error?: string
	helper?: string
	suffix?: string
	children?: ReactNode
}) {
	const id = useId()
	const style = failed
		? inputClass.replaceAll("border-z2", "border-warn").replaceAll("focus:border-accent", "focus:border-warn")
		: input.readOnly
			? inputClass.replaceAll("border-z2", "border-z1")
			: inputClass
	return (
		<div>
			<label htmlFor={id} className={labelClass}>
				{label}
			</label>
			<div className={`flex min-w-0 items-center gap-2${suffix ? " w-40" : ""}`}>
				<input
					id={id}
					{...input}
					aria-invalid={failed}
					aria-describedby={failed ? `${id}-error` : helper ? `${id}-helper` : undefined}
					className={`${style} min-w-0 text-sm${input.readOnly ? " text-muted" : ""}`}
				/>
				{suffix && <span className="font-cond text-sm text-muted">{suffix}</span>}
				{children}
			</div>
			{failed ? (
				<p id={`${id}-error`} role="alert" className="mt-1.5 font-cond text-xs text-warn">
					{error ?? "Not saved"}
				</p>
			) : (
				helper && (
					<p id={`${id}-helper`} className="mt-1.5 font-cond text-xs text-muted">
						{helper}
					</p>
				)
			)}
		</div>
	)
}
