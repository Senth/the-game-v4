"use client"

import { useAutosaveField } from "./autosave-provider"
import { AutosaveInput } from "./autosave-text-field"

export function AutosavePointsField({
	arcId,
	questId,
	serverValue,
}: {
	arcId: string
	questId: string
	serverValue: number | null
}) {
	const field = useAutosaveField({ arcId, questId, field: "points" }, serverValue)
	return (
		<AutosaveInput
			label="Points"
			type="number"
			inputMode="numeric"
			step={1}
			min={0}
			max={10000}
			value={field.value ?? ""}
			onChange={(event) => field.onChange(event.target.value === "" ? null : event.target.valueAsNumber)}
			onFocus={field.onFocus}
			onBlur={field.onBlur}
			failed={field.failed}
			error={field.error}
		/>
	)
}
