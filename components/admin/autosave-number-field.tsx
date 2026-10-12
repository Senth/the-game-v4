"use client"

import { useAutosaveField } from "./autosave-provider"
import { AutosaveInput } from "./autosave-text-field"

export function AutosaveNumberField({ serverValue, readOnly }: { serverValue: number; readOnly: boolean }) {
	const field = useAutosaveField<number | string>({ field: "lengthMinutes" }, serverValue)
	return (
		<AutosaveInput
			label="Length"
			type="number"
			min={1}
			max={1440}
			step={1}
			value={readOnly ? serverValue : field.value}
			readOnly={readOnly}
			suffix="min"
			helper={readOnly ? "Set at start. Use −5 / +5 min while live." : "The game ends this long after start."}
			onChange={(event) => {
				if (!readOnly) field.onChange(event.target.value === "" ? "" : event.target.valueAsNumber)
			}}
			onFocus={field.onFocus}
			onBlur={field.onBlur}
			failed={field.failed}
			error={field.error}
		/>
	)
}
