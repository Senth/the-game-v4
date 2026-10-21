"use client"

import { useAutosaveField } from "./autosave-provider"
import { AutosaveInput } from "./autosave-text-field"

export function NewQuestPointsField({ serverValue }: { serverValue: number | null }) {
	const field = useAutosaveField<number | null>({ field: "defaultQuestPoints" }, serverValue)
	const helper =
		field.value === null
			? "Empty means new quests start without points. Existing quests never change."
			: `New quests start with ${field.value}p. Existing quests never change.`
	return (
		<AutosaveInput
			label="New quest points"
			type="number"
			inputMode="numeric"
			min={0}
			max={10000}
			step={1}
			value={field.value ?? ""}
			suffix="p"
			placeholder="None"
			helper={helper}
			onChange={(event) => field.onChange(event.target.value === "" ? null : event.target.valueAsNumber)}
			onFocus={field.onFocus}
			onBlur={field.onBlur}
			failed={field.failed}
			error={field.error}
		/>
	)
}
