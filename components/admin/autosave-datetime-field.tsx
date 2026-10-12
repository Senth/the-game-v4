"use client"

import { useEffect, useState } from "react"
import { labelClass } from "@/components/auth-form"
import { formatSeasonStart } from "@/lib/domain/admin-seasons"
import { useAutosaveField } from "./autosave-provider"
import { AutosaveInput } from "./autosave-text-field"

export function AutosaveDatetimeField({
	serverValue,
	end,
	status,
}: {
	serverValue: Date | null
	end: Date | null
	status: "unscheduled" | "upcoming" | "live" | "ended"
}) {
	const field = useAutosaveField({ field: "start" }, serverValue)
	const [mounted, setMounted] = useState(false)
	useEffect(() => setMounted(true), [])
	if (status === "live" || status === "ended") {
		return (
			<div>
				<span className={labelClass}>Start</span>
				<p className="font-cond text-sm text-ink">{serverValue && formatSeasonStart(serverValue)}</p>
				{end && (
					<p className="mt-1.5 font-cond text-xs text-muted">
						{status === "ended" ? "Ended" : "Ends"} {formatSeasonStart(end).slice(-5)}.
					</p>
				)}
			</div>
		)
	}
	const localValue =
		mounted && field.value
			? new Date(field.value.getTime() - field.value.getTimezoneOffset() * 60_000).toISOString().slice(0, 19)
			: ""
	return (
		<AutosaveInput
			label="Start"
			type="datetime-local"
			step={60}
			value={localValue}
			onChange={(event) => field.onChange(event.target.value ? new Date(event.target.value) : null)}
			onFocus={field.onFocus}
			onBlur={field.onBlur}
			failed={field.failed}
			error={field.error}
			helper="Players see a countdown until then."
		>
			{field.value && (
				<button
					type="button"
					className="min-h-11 shrink-0 px-2 font-cond text-sm text-link hover:underline active:text-head focus-visible:outline-2 focus-visible:outline-accent"
					onClick={() => {
						field.onChange(null)
						void field.onBlur()
					}}
				>
					Clear
				</button>
			)}
		</AutosaveInput>
	)
}
