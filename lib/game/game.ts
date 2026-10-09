import { getSeason } from "@/lib/db/seasons"
import { getTeam, listTeams, revealHint as revealTeamHint, solveCurrentQuest } from "@/lib/db/teams"
import { findQuest, lifecycleState, matchesAnswer, scoreForSolve } from "@/lib/domain/game"
import { type PlayerGame, playerGame } from "@/lib/domain/player-game"
import type { Team } from "@/lib/domain/schemas"
import { boardChannel, publish, seasonChannel, teamChannel } from "@/lib/events/bus"

export type SubmitResult =
	| { ok: false; reason: "invalid" | "not-running" | "stale" }
	| { ok: true; correct: false }
	| { ok: true; correct: true; pointsEarned: number; game: PlayerGame }

export type RevealResult = { ok: false; reason: "not-running" | "stale" } | { ok: true; game: PlayerGame }

const maxAnswerLength = 200
const solveRetries = 3

export async function loadGame(team: Team, now = new Date()): Promise<PlayerGame> {
	if (!team.seasonId) return playerGame(null, team, [], now)
	const [season, teams] = await Promise.all([getSeason(team.seasonId), listTeams(team.seasonId)])
	return playerGame(season, team, teams, now)
}

function publishTeamChange(teamId: string, seasonId: string) {
	for (const channel of [teamChannel(teamId), seasonChannel(seasonId), boardChannel]) publish(channel)
}

const isRevealed = (team: Team, questId: string, hintId: string) =>
	team.progress.some(
		(entry) => entry.questId === questId && entry.hintsRevealed.some((snapshot) => snapshot.hintId === hintId),
	)

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
		const { questOrder, questIndex, progress } = current
		const quest = questOrder[questIndex] === questId ? findQuest(season, questId) : undefined
		if (!quest) return { ok: false, reason: "stale" }
		if (!matchesAnswer(answer, quest.answers)) return { ok: true, correct: false }
		const hintsRevealed = progress.find((entry) => entry.questId === questId)?.hintsRevealed ?? []
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
	const { questIndex } = team
	const questId = team.questOrder[questIndex]
	const hint = findQuest(season, questId)?.hints.find((candidate) => candidate.id === hintId)
	if (!questId || !hint) return { ok: false, reason: "stale" }
	if (isRevealed(team, questId, hintId)) return { ok: true, game: await loadGame(team, now) }
	const snapshot = { hintId, text: hint.text, points: hint.points, revealedAt: now }
	const written = await revealTeamHint(team._id, { questIndex, questId }, snapshot)
	const fresh = (await getTeam(team._id)) ?? team
	if (!written) {
		const raced = fresh.questIndex === questIndex && isRevealed(fresh, questId, hintId)
		return raced ? { ok: true, game: await loadGame(fresh, now) } : { ok: false, reason: "stale" }
	}
	publishTeamChange(team._id, season._id)
	return { ok: true, game: await loadGame(fresh, now) }
}
