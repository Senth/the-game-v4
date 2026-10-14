import type { Team } from "./schemas"

export function hintRevealers(teams: Pick<Team, "name" | "progress">[], questId: string): Record<string, string[]> {
	const byHint = new Map<string, { name: string; revealedAt: Date }[]>()
	for (const team of teams) {
		for (const progress of team.progress) {
			if (progress.questId !== questId) continue
			for (const hint of progress.hintsRevealed) {
				const revealers = byHint.get(hint.hintId) ?? []
				revealers.push({ name: team.name, revealedAt: hint.revealedAt })
				byHint.set(hint.hintId, revealers)
			}
		}
	}
	return Object.fromEntries(
		[...byHint].map(([hintId, revealers]) => [
			hintId,
			revealers.toSorted((a, b) => a.revealedAt.getTime() - b.revealedAt.getTime()).map(({ name }) => name),
		]),
	)
}

export function worthWithAllHints(points: number | null, hints: number[]): number | null {
	return points === null ? null : points - hints.reduce((total, penalty) => total + penalty, 0)
}
