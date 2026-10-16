import type { RevealedHint, Team } from "./schemas"

export function hintPenalty(snapshots: RevealedHint[]): number {
	return snapshots.reduce((sum, snapshot) => sum + snapshot.points, 0)
}

export function teamHintLoss(team: Pick<Team, "progress">): number {
	return team.progress.reduce((sum, progress) => sum + hintPenalty(progress.hintsRevealed), 0)
}
