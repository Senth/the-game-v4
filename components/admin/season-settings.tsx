"use client"

import { seasonStatus } from "@/lib/domain/admin-seasons"
import { defaultPlaceRadius } from "@/lib/domain/location"
import type { Season } from "@/lib/domain/schemas"
import { AutosaveDatetimeField } from "./autosave-datetime-field"
import { AutosaveNumberField } from "./autosave-number-field"
import { useAutosaveField } from "./autosave-provider"
import { AutosaveSwitch } from "./autosave-switch"
import { AutosaveInput, AutosaveTextField } from "./autosave-text-field"
import { FinisherBonusRows } from "./finisher-bonus-rows"
import { NewQuestPointsField } from "./new-quest-points-field"
import { RegistrationSwitch } from "./registration-switch"
import { useSeasonClock } from "./use-season-clock"

type Settings = Pick<
	Season,
	| "_id"
	| "title"
	| "start"
	| "end"
	| "lengthMinutes"
	| "defaultQuestPoints"
	| "placeRadius"
	| "shuffleArcs"
	| "registrationOpen"
	| "finisherBonuses"
	| "finishers"
>

export function NewPlaceRadiusField({ serverValue }: { serverValue: number }) {
	const field = useAutosaveField<number>({ field: "placeRadius" }, serverValue)
	const helperValue = Number.isFinite(field.value) ? field.value : serverValue
	return (
		<AutosaveInput
			label="New place radius"
			type="number"
			inputMode="numeric"
			min={5}
			max={500}
			step={1}
			value={Number.isNaN(field.value) ? "" : field.value}
			suffix="m"
			helper={`New places start with ${helperValue} m. Existing places never change.`}
			onChange={(event) => field.onChange(event.target.value === "" ? Number.NaN : event.target.valueAsNumber)}
			onFocus={field.onFocus}
			onBlur={field.onBlur}
			failed={field.failed}
			error={field.error}
		/>
	)
}

export function SeasonSettings({
	season,
	teams,
	now,
}: {
	season: Settings
	teams: { _id: string; name: string }[]
	now: number
}) {
	const currentNow = useSeasonClock(now, season.start, season.end)
	const status = seasonStatus(season, new Date(currentNow))
	const started = status === "live" || status === "ended"
	return (
		<div className="space-y-5 px-4 py-5 lg:px-8 lg:py-6">
			<h2 className="font-head text-2xl text-head">Season settings</h2>
			<AutosaveTextField label="Title" target={{ field: "title" }} serverValue={season.title} />
			<AutosaveDatetimeField serverValue={season.start} end={season.end} status={status} />
			<AutosaveNumberField serverValue={season.lengthMinutes} readOnly={started} />
			<NewQuestPointsField serverValue={season.defaultQuestPoints} />
			<NewPlaceRadiusField serverValue={season.placeRadius ?? defaultPlaceRadius} />
			<AutosaveSwitch serverValue={season.shuffleArcs} started={started} />
			<RegistrationSwitch seasonId={season._id} serverValue={season.registrationOpen} />
			<FinisherBonusRows season={season} teams={teams} />
		</div>
	)
}
