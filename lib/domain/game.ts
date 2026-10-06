import type { Quest, Season, TeamQuestProgress } from "./schemas"
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
