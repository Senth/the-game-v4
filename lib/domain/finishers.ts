import type { Season, Team } from "./schemas"

export function bonusForPlace(bonuses: readonly number[], place: number): number {
	return bonuses[place - 1] ?? 0
}

type ArrivalTeam = Pick<Team, "reachedAt" | "questOrder" | "progress">

export function arrivalTime(team: ArrivalTeam, season: Pick<Season, "start">): Date {
	return (
		team.reachedAt ??
		team.questOrder
			.toReversed()
			.map((id) => team.progress.find((entry) => entry.questId === id)?.solvedAt)
			.find((at) => at !== undefined) ??
		season.start ??
		new Date(0)
	)
}

export function sortByArrival<T extends ArrivalTeam>(teams: T[], season: Pick<Season, "start">): T[] {
	return teams.toSorted((a, b) => arrivalTime(a, season).getTime() - arrivalTime(b, season).getTime())
}

export function nextOpenBonus(
	season: Partial<Pick<Season, "finisherBonuses" | "finishers">>,
): { place: number; points: number } | null {
	const bonuses = season.finisherBonuses ?? []
	const index = bonuses.findIndex((points, index) => index >= (season.finishers ?? []).length && points > 0)
	return index < 0 ? null : { place: index + 1, points: bonusForPlace(bonuses, index + 1) }
}
