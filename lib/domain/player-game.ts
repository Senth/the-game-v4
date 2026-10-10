import {
	currentQuest,
	lifecycleState,
	type PaceBand,
	type PlayerQuest,
	paceFromCounts,
	paceLabel,
	playerView,
	questCounts,
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
			solved: number
			total: number
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
	const current = currentQuest(season, team)
	const counts = questCounts(team)
	const teamPace = paceFromCounts({ ...season, ...counts, now })
	return {
		lifecycleState: state,
		quest: current ? playerView(current.quest, current.progress) : null,
		score: team.score,
		...counts,
		start: season.start,
		end: season.end,
		pace: teamPace && { band: teamPace.band, label: paceLabel(teamPace.n) },
		rail: rail(season, team),
		strip: standingsStrip(teams, team._id),
	}
}
