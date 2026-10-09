import {
	findQuest,
	lifecycleState,
	type PaceBand,
	type PlayerQuest,
	pace,
	paceLabel,
	playerView,
	type RailArc,
	rail,
	type StripEntry,
	standingsStrip,
} from "./game"
import type { Season, Team } from "./schemas"

export type PlayerGame =
	| { lifecycleState: "waiting" }
	| { lifecycleState: "countdown"; start: Date }
	| {
			lifecycleState: "running"
			quest: PlayerQuest | null
			score: number
			start: Date
			end: Date | null
			pace: { band: PaceBand; label: string } | null
			rail: RailArc[]
			strip: StripEntry[]
	  }
	| { lifecycleState: "completed" | "ended"; score: number }

export function playerGame(
	season: Pick<Season, "start" | "end" | "arcs"> | null | undefined,
	team: Pick<Team, "_id" | "questOrder" | "questIndex" | "score" | "completed" | "progress">,
	teams: Pick<Team, "_id" | "name" | "score" | "progress">[],
	now: Date,
): PlayerGame {
	const state = lifecycleState(season ?? null, team, now)
	if (state === "waiting" || !season?.start) return { lifecycleState: "waiting" }
	if (state === "countdown") return { lifecycleState: state, start: season.start }
	if (state !== "running") return { lifecycleState: state, score: team.score }
	const quest = findQuest(season, team.questOrder[team.questIndex])
	const teamPace = pace(season, team, now)
	return {
		lifecycleState: state,
		quest: quest
			? playerView(
					quest,
					team.progress.find((entry) => entry.questId === quest.id),
				)
			: null,
		score: team.score,
		start: season.start,
		end: season.end,
		pace: teamPace && { band: teamPace.band, label: paceLabel(teamPace.n) },
		rail: rail(season, team),
		strip: standingsStrip(teams, team._id),
	}
}
