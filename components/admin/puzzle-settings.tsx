"use client"

import { useId } from "react"
import { labelClass } from "@/components/auth-form"
import { assetKind } from "@/lib/domain/assets"
import type { Quest } from "@/lib/domain/schemas"
import { useAutosaveField } from "./autosave-provider"
import { AutosaveInput } from "./autosave-text-field"

const defaultPuzzle = { rows: 4, cols: 4, showFull: false }

function PuzzleSwitch({
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

export function PuzzleSettings({
	arcId,
	questId,
	assetPath,
	puzzle,
	reachedTeams,
}: {
	arcId: string
	questId: string
	assetPath: string | null
	puzzle: Quest["puzzle"]
	reachedTeams: number
}) {
	const field = useAutosaveField<Quest["puzzle"]>({ arcId, questId, field: "puzzle" }, puzzle ?? null)
	const value = field.value ?? null
	const imageAvailable = !!assetPath && assetKind(assetPath) === "image"
	const locked = reachedTeams > 0
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
				<PuzzleSwitch
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
						<PuzzleSwitch
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
