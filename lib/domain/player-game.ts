import { nextOpenBonus, type PlayerFinisher, playerFinishers } from "./finishers"
import {
	boardSeasons,
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
	rankTeams,
	type StandingsRow,
	type StripEntry,
	standingsRows,
	standingsStrip,
} from "./game"
import type { Season, Team } from "./schemas"

export type PlayerGame =
	| { lifecycleState: "waiting" }
	| { lifecycleState: "countdown"; start: Date }
	| {
			lifecycleState: "running"
			teamId: string
			finishers: PlayerFinisher[]
			nextBonus: ReturnType<typeof nextOpenBonus>
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
	| {
			lifecycleState: "completed" | "ended"
			teamId: string
			finishers: PlayerFinisher[]
			score: number
			rank: number
			teamCount: number
	  }

export type PlayerStandings =
	| { lifecycleState: "waiting" | "countdown" }
	| {
			lifecycleState: "running"
			you: { name: string; score: number; solved: number; total: number }
			start: Date
			end: Date | null
			rows: StandingsRow[]
			finishers: PlayerFinisher[]
	  }
	| {
			lifecycleState: "completed" | "ended"
			you: { name: string; score: number; solved: number; total: number; rank: number; teamCount: number }
			rows: StandingsRow[]
			finishers: PlayerFinisher[]
	  }

export type PublicBoard =
	| {
			view: "running"
			title: string
			start: Date
			end: Date | null
			rows: StandingsRow[]
			finishers: PlayerFinisher[]
			nextBonus: ReturnType<typeof nextOpenBonus>
			nextStart: Date | null
	  }
	| { view: "final"; title: string; rows: StandingsRow[]; finishers: PlayerFinisher[]; nextStart: Date | null }
	| { view: "idle"; nextStart: Date | null }

export function publicBoard(seasons: Season[], teamsBySeason: Record<string, Team[]>, now: Date): PublicBoard {
	const { running, final, nextStart } = boardSeasons(seasons, now)
	const season = running ?? final
	if (!season) return { view: "idle", nextStart }
	const rows = standingsRows(season, teamsBySeason[season._id] ?? [], "", false)
	const finishers = playerFinishers(season, teamsBySeason[season._id] ?? [])
	if (running?.start)
		return {
			view: "running",
			title: running.title,
			start: running.start,
			end: running.end,
			rows,
			finishers,
			nextStart,
			nextBonus: nextOpenBonus(running),
		}
	return { view: "final", title: season.title, rows, finishers, nextStart }
}

export function playerGame(
	season:
		| (Pick<Season, "start" | "end" | "arcs" | "finishers"> & Partial<Pick<Season, "finisherBonuses">>)
		| null
		| undefined,
	team: Pick<Team, "_id" | "questOrder" | "questIndex" | "score" | "completed" | "progress">,
	teams: Pick<Team, "_id" | "name" | "score" | "progress">[],
	now: Date,
): PlayerGame {
	const state = lifecycleState(season ?? null, team, now)
	if (state === "waiting" || !season?.start) return { lifecycleState: "waiting" }
	if (state === "countdown") return { lifecycleState: state, start: season.start }
	const finishers = playerFinishers(season, teams)
	if (state !== "running") {
		return {
			lifecycleState: state,
			teamId: team._id,
			finishers,
			score: team.score,
			rank: rankTeams(teams).find((candidate) => candidate._id === team._id)?.rank ?? 1,
			teamCount: teams.length,
		}
	}
	const current = currentQuest(season, team)
	const counts = questCounts(team)
	const teamPace = paceFromCounts({ ...season, ...counts, now })
	return {
		lifecycleState: state,
		teamId: team._id,
		finishers,
		nextBonus: nextOpenBonus(season),
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

export function playerStandings(
	season: Pick<Season, "start" | "end" | "arcs" | "finishers"> | null | undefined,
	team: Pick<Team, "_id" | "name" | "questOrder" | "questIndex" | "score" | "completed" | "progress">,
	teams: Pick<Team, "_id" | "name" | "score" | "progress" | "questOrder" | "questIndex">[],
	now: Date,
): PlayerStandings {
	const state = lifecycleState(season ?? null, team, now)
	if (state === "waiting" || !season?.start) return { lifecycleState: "waiting" }
	if (state === "countdown") return { lifecycleState: state }
	const you = { name: team.name, score: team.score, ...questCounts(team) }
	const rows = standingsRows(season, teams, team._id, state === "running")
	const finishers = playerFinishers(season, teams)
	if (state === "running") return { lifecycleState: state, you, start: season.start, end: season.end, rows, finishers }
	return {
		lifecycleState: state,
		you: { ...you, rank: rows.find((row) => row.you)?.rank ?? 1, teamCount: rows.length },
		rows,
		finishers,
	}
}
