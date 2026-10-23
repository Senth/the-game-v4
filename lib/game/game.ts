import { getPuzzleTiles } from "@/lib/assets/puzzle-tiles"
import { sessionOptions } from "@/lib/auth/session"
import { claimFinish } from "@/lib/db/finishers"
import { getSeason, listSeasons } from "@/lib/db/seasons"
import { finishSeasonStructure, withSeasonStructure } from "@/lib/db/structural-writes"
import {
	editSeasonTeamOrders,
	ensurePuzzleState,
	fillQuestOrders,
	getTeam,
	listTeams,
	revealHint as revealTeamHint,
	solveCurrentQuest,
	writePuzzleDrop,
} from "@/lib/db/teams"
import {
	boardSeasons,
	currentQuest,
	findQuest,
	isRevealed,
	lifecycleState,
	matchesAnswer,
	maxAnswerLength,
	scoreForSolve,
} from "@/lib/domain/game"
import { evaluateFix, type Fix } from "@/lib/domain/location"
import {
	type PlayerGame,
	type PlayerStandings,
	type PublicBoard,
	playerGame,
	playerStandings,
	publicBoard,
} from "@/lib/domain/player-game"
import { dropPiece, isSolved, pieceIds, randomSpread } from "@/lib/domain/puzzle"
import { type Season, Spot, type Team } from "@/lib/domain/schemas"
import { boardChannel, publish, seasonChannel, teamChannel } from "@/lib/events/bus"
import { recordFix } from "./location-fixes"

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
	const [season, listed] = await Promise.all([getSeason(team.seasonId), listTeams(team.seasonId)])
	let freshSeason = season
	let teams = await fillEmptyQuestOrders(season, listed, now)
	let current = teams.find((candidate) => candidate._id === team._id) ?? team
	if (season && lifecycleState(season, current, now) === "running") {
		const missing = [
			...new Set(
				teams.flatMap((candidate) =>
					candidate.questOrder.slice(candidate.questIndex).filter((id) => !findQuest(season, id)),
				),
			),
		]
		if (missing.length) {
			await withSeasonStructure(season._id, async () => {
				await finishSeasonStructure(season._id)
				const latest = await getSeason(season._id)
				if (!latest) return
				const listed = await listTeams(season._id)
				const missing = [
					...new Set(
						listed.flatMap((candidate) =>
							candidate.questOrder.slice(candidate.questIndex).filter((id) => !findQuest(latest, id)),
						),
					),
				]
				if ((await editSeasonTeamOrders(season._id, { kind: "deleteQuest", questIds: missing })).length) {
					publish(seasonChannel(season._id))
					publish(boardChannel)
				}
			})
			teams = await listTeams(season._id)
			freshSeason = await getSeason(season._id)
			current = teams.find((candidate) => candidate._id === team._id) ?? current
		}
	}
	if (season && current.completed && current.finisherBonusApplied === false) {
		await withSeasonStructure(season._id, async () => {
			await finishSeasonStructure(season._id)
			await claimFinish(season._id, current._id, now)
		})
		teams = await listTeams(season._id)
		current = teams.find((candidate) => candidate._id === team._id) ?? current
		publishTeamChange(current._id, season._id)
		freshSeason = await getSeason(season._id)
	}
	const found = await withSeasonStructure(team.seasonId, async () => {
		await finishSeasonStructure(team.seasonId)
		freshSeason = await getSeason(team.seasonId)
		current = (await getTeam(team._id)) ?? current
		const found =
			freshSeason && lifecycleState(freshSeason, current, now) === "running" ? currentQuest(freshSeason, current) : null
		if (found?.quest.puzzle && found.quest.assetPath && !found.progress?.puzzle) {
			await ensurePuzzleState(
				current._id,
				{ questId: found.quest.id, questIndex: current.questIndex },
				{
					version: 0,
					spots: randomSpread(found.quest.puzzle.rows * found.quest.puzzle.cols),
				},
			)
			current = (await getTeam(current._id)) ?? current
		}
		return found
	})
	if (found?.quest.puzzle && found.quest.assetPath) {
		const { quest } = found
		const { rows, cols } = found.quest.puzzle
		const { aspect } = await getPuzzleTiles(found.quest.assetPath, rows, cols)
		current = (await getTeam(current._id)) ?? current
		if (current.questOrder[current.questIndex] !== quest.id) return loadGame(current, now)
		const ids = await pieceIds(quest.id, found.quest.assetPath, rows, cols, sessionOptions().password)
		return playerGame(freshSeason, current, teams, now, { ids, aspect, fullUrl: `/api/puzzle/${quest.id}/full` })
	}
	return playerGame(freshSeason, current, teams, now)
}

export type PuzzleDropResult = { status: "moved" | "stale" } | { status: "solved"; pointsEarned: number }

export async function dropPuzzlePiece(
	team: Team,
	questId: string,
	pieceId: string,
	target: Spot,
	now = new Date(),
): Promise<PuzzleDropResult> {
	const parsed = Spot.safeParse(target)
	if (!parsed.success) return { status: "stale" }
	const season = await getSeason(team.seasonId)
	for (let attempt = 0; attempt <= solveRetries; attempt++) {
		const current = await getTeam(team._id)
		if (!current || current.seasonId !== team.seasonId || !season || lifecycleState(season, current, now) !== "running")
			return { status: "stale" }
		const found = currentQuest(season, current)
		if (found?.quest.id !== questId || !found.quest.puzzle || !found.quest.assetPath || !found.progress?.puzzle)
			return { status: "stale" }
		const { rows, cols } = found.quest.puzzle
		const ids = await pieceIds(questId, found.quest.assetPath, rows, cols, sessionOptions().password)
		const index = ids.indexOf(pieceId)
		if (index < 0 || ("cell" in parsed.data && parsed.data.cell >= rows * cols)) return { status: "stale" }
		const state = dropPiece(found.progress.puzzle, index, parsed.data)
		if (!(await writePuzzleDrop(current._id, { questId, questIndex: current.questIndex }, state))) continue
		if (isSolved(state)) {
			for (let retry = 0; retry <= solveRetries; retry++) {
				const fresh = await getTeam(team._id)
				const progress = fresh?.progress.find((entry) => entry.questId === questId)
				if (!fresh || fresh.questOrder[fresh.questIndex] !== questId || !progress?.puzzle || !isSolved(progress.puzzle))
					break
				const pointsEarned = scoreForSolve(found.quest, progress)
				const expected = {
					questId,
					questIndex: fresh.questIndex,
					orderLength: fresh.questOrder.length,
					hintCount: progress.hintsRevealed.length,
					puzzleVersion: progress.puzzle.version,
				}
				if (await solveCurrentQuest(fresh._id, expected, now, pointsEarned)) {
					if (fresh.questIndex + 1 === fresh.questOrder.length) await claimFinish(season._id, fresh._id, now)
					publishTeamChange(fresh._id, season._id)
					return { status: "solved", pointsEarned }
				}
			}
		}
		publish(teamChannel(current._id))
		return { status: "moved" }
	}
	return { status: "stale" }
}

export async function getSolvedPuzzle(
	team: Team,
	questId: string,
): Promise<{ ids: string[]; pointsEarned: number } | null> {
	const current = await getTeam(team._id)
	if (!current || current.seasonId !== team.seasonId) return null
	const progress = current.progress.find((entry) => entry.questId === questId && entry.solvedAt)
	if (!progress) return null
	const season = await getSeason(current.seasonId)
	const quest = season && findQuest(season, questId)
	if (!quest?.puzzle || !quest.assetPath) return null
	return {
		ids: await pieceIds(questId, quest.assetPath, quest.puzzle.rows, quest.puzzle.cols, sessionOptions().password),
		pointsEarned: progress.pointsEarned,
	}
}

export async function loadStandings(team: Team, now = new Date()): Promise<PlayerStandings> {
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

export type PositionResult =
	| { status: "outside" | "rough" | "stale" | "stop" }
	| { status: "solved"; pointsEarned: number }

export async function reportPosition(
	team: Team,
	phoneId: string,
	questId: string,
	fix: Fix,
	now = new Date(),
): Promise<PositionResult> {
	for (let attempt = 0; attempt <= solveRetries; attempt++) {
		const [season, current] = await Promise.all([getSeason(team.seasonId), getTeam(team._id)])
		if (!season || !current || current.seasonId !== team.seasonId || lifecycleState(season, current, now) !== "running")
			return { status: "stop" }
		const found = currentQuest(season, current)
		if (found?.quest.id !== questId || !found.quest.location) return { status: "stop" }
		const status = evaluateFix(found.quest.location, fix, now.getTime())
		if (status === "rough" || status === "stale") return { status }
		recordFix(current._id, phoneId, fix, now.getTime())
		if (status === "outside") return { status }
		const { questIndex, questOrder } = current
		const hintsRevealed = found.progress?.hintsRevealed ?? []
		const pointsEarned = scoreForSolve(found.quest, { hintsRevealed })
		const expected = {
			questIndex,
			questId,
			orderLength: questOrder.length,
			hintCount: hintsRevealed.length,
			location: found.quest.location,
		}
		if (await solveCurrentQuest(current._id, expected, now, pointsEarned)) {
			if (questIndex + 1 === questOrder.length) await claimFinish(season._id, current._id, now)
			publishTeamChange(current._id, season._id)
			return { status: "solved", pointsEarned }
		}
		const fresh = await getTeam(team._id)
		if (!fresh || fresh.questOrder[fresh.questIndex] !== questId) return { status: "stop" }
	}
	return { status: "stop" }
}

export async function getSolvedLocation(team: Team, questId: string): Promise<{ pointsEarned: number } | null> {
	const current = await getTeam(team._id)
	if (!current || current.seasonId !== team.seasonId) return null
	const progress = current.progress.find((entry) => entry.questId === questId && entry.solvedAt)
	if (!progress) return null
	const season = await getSeason(current.seasonId)
	if (!season || !findQuest(season, questId)?.location) return null
	return { pointsEarned: progress.pointsEarned }
}

export async function submitAnswer(
	team: Team,
	questId: string,
	answer: string,
	now = new Date(),
): Promise<SubmitResult> {
	if (typeof answer !== "string" || answer.length > maxAnswerLength) return { ok: false, reason: "invalid" }
	const season = await getSeason(team.seasonId)
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
			if (questIndex + 1 === questOrder.length) await claimFinish(season._id, current._id, now)
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
	const season = await getSeason(team.seasonId)
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
