"use client"

import { labelClass } from "@/components/auth-form"
import { assetKind } from "@/lib/domain/assets"
import type { Quest } from "@/lib/domain/schemas"
import { useAutosaveField } from "./autosave-provider"
import { AutosaveInput } from "./autosave-text-field"
import { SettingsSwitch } from "./settings-switch"

const defaultPuzzle = { rows: 4, cols: 4, showFull: false }

export function PuzzleSettings({
	arcId,
	questId,
	assetPath,
	puzzle,
	location = null,
	reachedTeams,
}: {
	arcId: string
	questId: string
	assetPath: string | null
	puzzle: Quest["puzzle"]
	location?: Quest["location"]
	reachedTeams: number
}) {
	const field = useAutosaveField<Quest["puzzle"]>({ arcId, questId, field: "puzzle" }, puzzle ?? null)
	const value = field.value ?? null
	const imageAvailable = !!assetPath && assetKind(assetPath) === "image"
	const locked = reachedTeams > 0
	if (location) {
		return (
			<div>
				<span className={labelClass}>Puzzle</span>
				<p className="font-cond text-xs text-muted">Puzzle mode is off while this quest has a place.</p>
			</div>
		)
	}
	if (!imageAvailable) {
		return (
			<div>
				<span className={labelClass}>Puzzle</span>
				<p className="font-cond text-xs text-muted">Upload an image to enable puzzle mode.</p>
			</div>
		)
	}
	return (
		<div>
			<span className={labelClass}>Puzzle</span>
			<div className="bg-z1 rounded-md p-3 space-y-3">
				<SettingsSwitch
					label="Puzzle mode"
					helper="Players get shuffled pieces, never the picture."
					checked={value !== null}
					disabled={locked}
					onChange={() => field.onChange(value ? null : defaultPuzzle)}
					onFocus={field.onFocus}
					onBlur={() => void field.onBlur()}
				/>
				{value && (
					<>
						<div className={`flex gap-4${locked ? " opacity-60" : ""}`}>
							{(["rows", "cols"] as const).map((dimension) => {
								const number = value[dimension]
								const invalid = !Number.isInteger(number) || number < 2 || number > 7
								return (
									<div key={dimension} className="w-40">
										<AutosaveInput
											label={dimension === "rows" ? "Rows" : "Columns"}
											type="number"
											inputMode="numeric"
											min={2}
											max={7}
											step={1}
											disabled={locked}
											value={Number.isNaN(number) ? "" : number}
											failed={field.failed || invalid}
											error={invalid ? "Use 2 to 7." : field.error}
											onChange={(event) =>
												field.onChange({
													...value,
													[dimension]: event.target.value === "" ? Number.NaN : event.target.valueAsNumber,
												})
											}
											onFocus={field.onFocus}
											onBlur={() => void field.onBlur()}
										/>
									</div>
								)
							})}
						</div>
						<SettingsSwitch
							label="Show full picture"
							helper="Players see the picture above the pieces."
							checked={value.showFull}
							onChange={() => field.onChange({ ...value, showFull: !value.showFull })}
							onFocus={field.onFocus}
							onBlur={() => void field.onBlur()}
						/>
					</>
				)}
				{locked && (
					<p className="font-cond text-xs text-muted">
						Locked: {reachedTeams} {reachedTeams === 1 ? "team has" : "teams have"} reached this puzzle.
					</p>
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
