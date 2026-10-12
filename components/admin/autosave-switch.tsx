"use client"

import { useId } from "react"
import { labelClass } from "@/components/auth-form"
import { useAutosaveField } from "./autosave-provider"

export function SeasonSwitch({
	label,
	checked,
	onChange,
	onFocus,
	onBlur,
	helper,
	valueLabel,
	disabled,
	failed,
	error,
}: {
	label: string
	checked: boolean
	onChange: () => void
	onFocus?: () => void
	onBlur?: () => void
	helper: string
	valueLabel: string
	disabled?: boolean
	failed: boolean
	error?: string
}) {
	const id = useId()
	return (
		<div>
			<span id={`${id}-label`} className={labelClass}>
				{label}
			</span>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				aria-labelledby={`${id}-label`}
				aria-describedby={failed ? `${id}-error` : `${id}-helper`}
				aria-invalid={failed}
				disabled={disabled}
				onClick={onChange}
				onFocus={onFocus}
				onBlur={onBlur}
				className="flex min-h-11 items-center gap-3 rounded-md font-cond text-sm hover:text-head active:text-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
			>
				<span
					aria-hidden="true"
					className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full ${checked ? "bg-accent" : "bg-z2"}${failed ? " outline-2 outline-warn" : ""}`}
				>
					<span className={`absolute size-5 rounded-full bg-head ${checked ? "left-6" : "left-1"}`} />
				</span>
				{valueLabel}
			</button>
			{failed ? (
				<p id={`${id}-error`} role="alert" className="mt-1.5 font-cond text-xs text-warn">
					{error ?? "Not saved"}
				</p>
			) : (
				<p id={`${id}-helper`} className="mt-1.5 font-cond text-xs text-muted">
					{helper}
				</p>
			)}
		</div>
	)
}

export function AutosaveSwitch({ serverValue, started }: { serverValue: boolean; started: boolean }) {
	const field = useAutosaveField({ field: "shuffleArcs" }, serverValue)
	return (
		<SeasonSwitch
			label="Shuffle arcs"
			checked={field.value}
			onChange={() => field.onChange(!field.value)}
			onFocus={field.onFocus}
			onBlur={() => void field.onBlur()}
			valueLabel={field.value ? "On" : "Off"}
			helper={started ? "Applies to teams that join from now on." : "Each team plays the arcs in its own order."}
			failed={field.failed}
			error={field.error}
		/>
	)
}
