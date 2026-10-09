import { getSeason } from "@/lib/db/seasons"
import { getTeam, listTeams, solveCurrentQuest } from "@/lib/db/teams"
import { findQuest, lifecycleState, matchesAnswer, scoreForSolve } from "@/lib/domain/game"
import { type PlayerGame, playerGame } from "@/lib/domain/player-game"
import type { Team } from "@/lib/domain/schemas"
import { boardChannel, publish, seasonChannel, teamChannel } from "@/lib/events/bus"

export type SubmitResult =
	| { ok: false; reason: "invalid" | "not-running" | "stale" }
	| { ok: true; correct: false }
	| { ok: true; correct: true; pointsEarned: number; game: PlayerGame }

const maxAnswerLength = 200
const solveRetries = 3

export async function loadGame(team: Team, now = new Date()): Promise<PlayerGame> {
	if (!team.seasonId) return playerGame(null, team, [], now)
	const [season, teams] = await Promise.all([getSeason(team.seasonId), listTeams(team.seasonId)])
	return playerGame(season, team, teams, now)
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
		const { questOrder, questIndex, progress } = current
		const quest = questOrder[questIndex] === questId ? findQuest(season, questId) : undefined
		if (!quest) return { ok: false, reason: "stale" }
		if (!matchesAnswer(answer, quest.answers)) return { ok: true, correct: false }
		const hintsRevealed = progress.find((entry) => entry.questId === questId)?.hintsRevealed ?? []
		const pointsEarned = scoreForSolve(quest, { hintsRevealed })
		const expected = { questIndex, questId, orderLength: questOrder.length, hintCount: hintsRevealed.length }
		if (await solveCurrentQuest(current._id, expected, now, pointsEarned)) {
			for (const channel of [teamChannel(current._id), seasonChannel(season._id), boardChannel]) publish(channel)
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
