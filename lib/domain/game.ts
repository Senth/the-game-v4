import type { Quest, Season, Team, TeamQuestProgress } from "./schemas"
import { hintPenalty } from "./scoring"

const normalizeAnswer = (answer: string) => answer.normalize("NFC").trim().toLowerCase()

export function matchesAnswer(submitted: string, answers: string[]): boolean {
	const normalized = normalizeAnswer(submitted)
	return answers.some((answer) => normalizeAnswer(answer) === normalized)
}

export function scoreForSolve(quest: Quest, progress: TeamQuestProgress): number {
	return (quest.points ?? 0) - hintPenalty(progress.hintsRevealed)
}

function shuffle<T>(items: T[], random: () => number): T[] {
	const copy = [...items]
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1))
		;[copy[i], copy[j]] = [copy[j] as T, copy[i] as T]
	}
	return copy
}

export function buildQuestOrder(season: Season, random: () => number = Math.random): string[] {
	const arcs = season.shuffleArcs ? shuffle(season.arcs, random) : season.arcs
	return arcs.flatMap((arc) => {
		const ids = arc.quests.map((quest) => quest.id)
		return arc.shuffleQuests ? shuffle(ids, random) : ids
	})
}

export type PaceBand = "pace-ok" | "pace-1" | "pace-2" | "pace-3"

export type Pace = {
	timePercent: number
	solvedPercent: number
	behindPercent: number
	band: PaceBand
	n: number
}

export function pace(
	season: Pick<Season, "start" | "end">,
	team: Pick<Team, "questOrder" | "progress">,
	now: Date,
): Pace | null {
	const { start, end } = season
	const total = team.questOrder.length
	if (!start || !end || end.getTime() <= start.getTime() || total === 0) return null
	const timeFraction = Math.min(Math.max((now.getTime() - start.getTime()) / (end.getTime() - start.getTime()), 0), 1)
	const order = new Set(team.questOrder)
	const solved = team.progress.filter((entry) => entry.solvedAt && order.has(entry.questId)).length
	const timePercent = 100 * timeFraction
	const solvedPercent = 100 * (solved / total)
	const behindPercent = timePercent - solvedPercent
	const band =
		behindPercent <= 0 ? "pace-ok" : behindPercent <= 10 ? "pace-1" : behindPercent <= 20 ? "pace-2" : "pace-3"
	return { timePercent, solvedPercent, behindPercent, band, n: Math.round(timeFraction * total) - solved }
}

export function paceLabel(n: number): string {
	if (n > 0) return `${n} behind`
	if (n < 0) return `${-n} ahead`
	return "On pace"
}
