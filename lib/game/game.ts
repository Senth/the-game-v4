import { getSeason, listSeasons } from "@/lib/db/seasons"
import { fillQuestOrders, getTeam, listTeams, revealHint as revealTeamHint, solveCurrentQuest } from "@/lib/db/teams"
import {
	boardSeasons,
	currentQuest,
	isRevealed,
	lifecycleState,
	matchesAnswer,
	maxAnswerLength,
	scoreForSolve,
} from "@/lib/domain/game"
import {
	type PlayerGame,
	type PlayerStandings,
	type PublicBoard,
	playerGame,
	playerStandings,
	publicBoard,
} from "@/lib/domain/player-game"
import type { Season, Team } from "@/lib/domain/schemas"
import { boardChannel, publish, seasonChannel, teamChannel } from "@/lib/events/bus"

export type SubmitResult =
	| { ok: false; reason: "invalid" | "not-running" | "stale" }
	| { ok: true; correct: false }
	| { ok: true; correct: true; pointsEarned: number; game: PlayerGame }

export type RevealResult = { ok: false; reason: "not-running" | "stale" } | { ok: true; game: PlayerGame }

const solveRetries = 3

async function fillEmptyQuestOrders(season: Season | null, teams: Team[], now: Date): Promise<Team[]> {
	if (
		!season?.start ||
		season.start > now ||
		!teams.some((team) => team.questOrder.length === 0 && team.progress.length === 0)
	) {
		return teams
	}
	if (await fillQuestOrders(season, teams)) {
		publish(seasonChannel(season._id))
		publish(boardChannel)
	}
	return listTeams(season._id)
}

export async function loadGame(team: Team, now = new Date()): Promise<PlayerGame> {
	if (!team.seasonId) return playerGame(null, team, [], now)
	const [season, listed] = await Promise.all([getSeason(team.seasonId), listTeams(team.seasonId)])
	const teams = await fillEmptyQuestOrders(season, listed, now)
	return playerGame(season, teams.find((candidate) => candidate._id === team._id) ?? team, teams, now)
}

export async function loadStandings(team: Team, now = new Date()): Promise<PlayerStandings> {
	if (!team.seasonId) return playerStandings(null, team, [], now)
	const [season, listed] = await Promise.all([getSeason(team.seasonId), listTeams(team.seasonId)])
	const teams = await fillEmptyQuestOrders(season, listed, now)
	return playerStandings(season, teams.find((candidate) => candidate._id === team._id) ?? team, teams, now)
}

export async function loadBoard(now = new Date()): Promise<PublicBoard> {
	const seasons = await listSeasons()
	const { running, final } = boardSeasons(seasons, now)
	const season = running ?? final
	const teamsBySeason = season
		? { [season._id]: await fillEmptyQuestOrders(season, await listTeams(season._id), now) }
		: {}
	return publicBoard(seasons, teamsBySeason, now)
}

function publishTeamChange(teamId: string, seasonId: string) {
	for (const channel of [teamChannel(teamId), seasonChannel(seasonId), boardChannel]) publish(channel)
}

export async function submitAnswer(
	team: Team,
	questId: string,
	answer: string,
	now = new Date(),
): Promise<SubmitResult> {
	if (typeof answer !== "string" || answer.length > maxAnswerLength) return { ok: false, reason: "invalid" }
	const season = team.seasonId ? await getSeason(team.seasonId) : null
	let current: Team | null = team
	for (let attempt = 0; attempt <= solveRetries && current; attempt++) {
		if (!season || lifecycleState(season, current, now) !== "running") return { ok: false, reason: "not-running" }
		const found = currentQuest(season, current)
		if (found?.quest.id !== questId) return { ok: false, reason: "stale" }
		const { quest, progress } = found
		if (!matchesAnswer(answer, quest.answers)) return { ok: true, correct: false }
		const { questOrder, questIndex } = current
		const hintsRevealed = progress?.hintsRevealed ?? []
		const pointsEarned = scoreForSolve(quest, { hintsRevealed })
		const expected = { questIndex, questId, orderLength: questOrder.length, hintCount: hintsRevealed.length }
		if (await solveCurrentQuest(current._id, expected, now, pointsEarned)) {
			publishTeamChange(current._id, season._id)
			return {
				ok: true,
				correct: true,
				pointsEarned,
				game: await loadGame((await getTeam(current._id)) ?? current, now),
			}
		}
		current = await getTeam(team._id)
	}
	return { ok: false, reason: "stale" }
}

export async function revealHint(team: Team, hintId: string, now = new Date()): Promise<RevealResult> {
	const season = team.seasonId ? await getSeason(team.seasonId) : null
	if (!season || lifecycleState(season, team, now) !== "running") return { ok: false, reason: "not-running" }
	const found = currentQuest(season, team)
	const hint = found?.quest.hints.find((candidate) => candidate.id === hintId)
	if (!found || !hint) return { ok: false, reason: "stale" }
	if (isRevealed(found.progress, hintId)) return { ok: true, game: await loadGame(team, now) }
	const { questIndex } = team
	const questId = found.quest.id
	const snapshot = { hintId, text: hint.text, points: hint.points, revealedAt: now }
	const written = await revealTeamHint(team._id, { questIndex, questId }, snapshot)
	const fresh = (await getTeam(team._id)) ?? team
	if (!written) {
		const raced = fresh.questIndex === questIndex && isRevealed(currentQuest(season, fresh)?.progress, hintId)
		return raced ? { ok: true, game: await loadGame(fresh, now) } : { ok: false, reason: "stale" }
	}
	publishTeamChange(team._id, season._id)
	return { ok: true, game: await loadGame(fresh, now) }
}
