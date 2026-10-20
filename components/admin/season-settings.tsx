"use client"

import { seasonStatus } from "@/lib/domain/admin-seasons"
import type { Season } from "@/lib/domain/schemas"
import { AutosaveDatetimeField } from "./autosave-datetime-field"
import { AutosaveNumberField } from "./autosave-number-field"
import { AutosaveSwitch } from "./autosave-switch"
import { AutosaveTextField } from "./autosave-text-field"
import { FinisherBonusRows } from "./finisher-bonus-rows"
import { RegistrationSwitch } from "./registration-switch"
import { useSeasonClock } from "./use-season-clock"

type Settings = Pick<
	Season,
	| "_id"
	| "title"
	| "start"
	| "end"
	| "lengthMinutes"
	| "shuffleArcs"
	| "registrationOpen"
	| "finisherBonuses"
	| "finishers"
>

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
			<AutosaveSwitch serverValue={season.shuffleArcs} started={started} />
			<RegistrationSwitch seasonId={season._id} serverValue={season.registrationOpen} />
			<FinisherBonusRows season={season} teams={teams} />
		</div>
	)
}
