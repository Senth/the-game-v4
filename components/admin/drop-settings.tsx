"use client"

import { labelClass } from "@/components/auth-form"
import type { Quest } from "@/lib/domain/schemas"
import { useAutosaveField, useDraftValue } from "./autosave-provider"
import { AutosaveInput } from "./autosave-text-field"
import { SettingsSwitch } from "./settings-switch"

const defaults = { fullMinutes: 10, dropMinutes: 20, floor: 0 }
const fields = [
	{ name: "fullMinutes", label: "Full for", min: 0, max: 1440, suffix: "min" },
	{ name: "dropMinutes", label: "Drop over", min: 1, max: 1440, suffix: "min" },
	{ name: "floor", label: "Floor", min: 0, max: 10000, suffix: "p" },
] as const

export function DropSettings({
	arcId,
	questId,
	drop,
	points,
}: {
	arcId: string
	questId: string
	drop: Quest["drop"]
	points: Quest["points"]
}) {
	const field = useAutosaveField<Quest["drop"]>({ arcId, questId, field: "drop" }, drop ?? null)
	const value = field.value ?? null
	const currentPoints = useDraftValue({ arcId, questId, field: "points" }, points)
	const validDrop =
		value !== null &&
		fields.every(({ name, min, max }) => Number.isInteger(value[name]) && value[name] >= min && value[name] <= max)
	const summary =
		currentPoints === null
			? "Set points first."
			: `${currentPoints}p for the first ${value?.fullMinutes ?? defaults.fullMinutes} min, then down to ${value?.floor ?? defaults.floor}p at ${(value?.fullMinutes ?? defaults.fullMinutes) + (value?.dropMinutes ?? defaults.dropMinutes)} min.`
	const floorWarning = validDrop && value !== null && currentPoints !== null && value.floor >= currentPoints

	return (
		<div>
			<span className={labelClass}>Points drop</span>
			<div className="bg-z1 rounded-md p-3 space-y-3">
				<SettingsSwitch
					label="Drop over time"
					helper="Worth falls the longer a team stays on this quest."
					checked={value !== null}
					onChange={() => field.onChange(value ? null : defaults)}
					onFocus={field.onFocus}
					onBlur={() => void field.onBlur()}
				/>
				{value && (
					<>
						<div className="grid grid-cols-3 gap-3">
							{fields.map(({ name, label, min, max, suffix }) => {
								const number = value[name]
								const invalid = !Number.isInteger(number) || number < min || number > max
								return (
									<div key={name} className="min-w-0">
										<AutosaveInput
											label={label}
											type="number"
											inputMode="numeric"
											min={min}
											max={max}
											step={1}
											value={Number.isNaN(number) ? "" : number}
											failed={field.failed || invalid}
											error={invalid ? `Use ${min} to ${max}.` : field.error}
											onChange={(event) =>
												field.onChange({
													...value,
													[name]: event.target.value === "" ? Number.NaN : event.target.valueAsNumber,
												})
											}
											onFocus={field.onFocus}
											onBlur={() => void field.onBlur()}
										>
											<span className="font-cond text-sm text-muted">{suffix}</span>
										</AutosaveInput>
									</div>
								)
							})}
						</div>
						{(validDrop || currentPoints === null) && <p className="font-cond text-xs text-muted">{summary}</p>}
						{floorWarning && (
							<p className="font-cond text-xs text-warn">Floor is at or above points, so nothing drops.</p>
						)}
					</>
				)}
				{field.failed && !value && (
					<p role="alert" className="font-cond text-xs text-warn">
						{field.error ?? "Not saved"}
					</p>
				)}
			</div>
		</div>
	)
}
