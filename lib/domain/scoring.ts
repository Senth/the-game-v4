import type { Quest, RevealedHint, Team } from "./schemas"

export function timeWorth(points: number | null, drop: Quest["drop"], elapsedMs: number): number | null {
	if (!drop || points === null || points <= drop.floor) return points
	const dropMs = drop.dropMinutes * 60_000
	const elapsedDropMs = Math.min(dropMs, Math.max(0, elapsedMs - drop.fullMinutes * 60_000))
	return points - Math.floor(((points - drop.floor) * elapsedDropMs) / dropMs)
}

export function timeBonus(
	points: number | null,
	drop: Quest["drop"],
	elapsedMs: number,
): { bonus: number; maxBonus: number; next: { bonus: number; inMs: number } | null } | null {
	if (!drop || points === null || points <= drop.floor) return null
	const maxBonus = points - drop.floor
	const bonus = (timeWorth(points, drop, elapsedMs) ?? points) - drop.floor
	const nextAt = drop.fullMinutes * 60_000 + Math.ceil(((maxBonus - bonus + 1) * drop.dropMinutes * 60_000) / maxBonus)
	return { bonus, maxBonus, next: bonus > 0 ? { bonus: bonus - 1, inMs: nextAt - elapsedMs } : null }
}

export function hintPenalty(snapshots: RevealedHint[]): number {
	return snapshots.reduce((sum, snapshot) => sum + snapshot.points, 0)
}

export function teamHintLoss(team: Pick<Team, "progress">): number {
	return team.progress.reduce((sum, progress) => sum + hintPenalty(progress.hintsRevealed), 0)
}
