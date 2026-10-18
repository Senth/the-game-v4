"use client"

import { type ComponentProps, type ReactNode, useId } from "react"
import { inputClass, labelClass } from "@/components/auth-form"
import { useAutosaveField } from "./autosave-provider"

export function AutosaveTextField({
	label,
	target,
	serverValue,
	autoFocus,
	missing,
}: {
	label: ReactNode
	target: Parameters<typeof useAutosaveField>[0]
	serverValue: string
	autoFocus?: boolean
	missing?: string
}) {
	const field = useAutosaveField(target, serverValue)
	return (
		<AutosaveInput
			label={label}
			missing={missing}
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
	missing,
	helper,
	suffix,
	children,
	...input
}: Omit<ComponentProps<"input">, "id" | "className" | "children"> & {
	label: ReactNode
	failed: boolean
	error?: string
	missing?: string
	helper?: string
	suffix?: string
	children?: ReactNode
}) {
	const id = useId()
	const isMissing = !!missing && !String(input.value ?? "").trim()
	const style =
		failed || isMissing
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
					aria-invalid={failed || undefined}
					aria-describedby={failed ? `${id}-error` : isMissing ? `${id}-missing` : helper ? `${id}-helper` : undefined}
					className={`${style} min-w-0 text-sm${input.readOnly ? " text-muted" : ""}`}
				/>
				{suffix && <span className="font-cond text-sm text-muted">{suffix}</span>}
				{children}
			</div>
			{failed ? (
				<p id={`${id}-error`} role="alert" className="mt-1.5 font-cond text-xs text-warn">
					{error ?? "Not saved"}
				</p>
			) : isMissing ? (
				<p id={`${id}-missing`} className="mt-1.5 font-cond text-xs text-warn">
					{missing}
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
