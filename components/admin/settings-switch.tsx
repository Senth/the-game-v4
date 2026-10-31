"use client"

import { useId } from "react"

export function SettingsSwitch({
	label,
	helper,
	checked,
	disabled = false,
	onChange,
	onFocus,
	onBlur,
}: {
	label: string
	helper: string
	checked: boolean
	disabled?: boolean
	onChange: () => void
	onFocus: () => void
	onBlur: () => void
}) {
	const id = useId()
	return (
		<div className="flex min-h-11 items-start justify-between gap-3">
			<div className="min-w-0">
				<p className={`font-cond text-sm ${disabled ? "text-muted" : "text-ink"}`}>{label}</p>
				<p id={`${id}-helper`} className="font-cond text-xs text-muted">
					{helper}
				</p>
			</div>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				aria-label={label}
				aria-describedby={`${id}-helper`}
				disabled={disabled}
				onClick={onChange}
				onFocus={onFocus}
				onBlur={onBlur}
				className="mt-1 flex h-11 w-12 shrink-0 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
			>
				<span
					aria-hidden="true"
					className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 ${checked ? "bg-accent" : "bg-z2"}`}
				>
					<span className={`size-5 rounded-full bg-head${checked ? " ml-auto" : ""}`} />
				</span>
			</button>
		</div>
	)
}
