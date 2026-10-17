import { hintRevealers } from "./hints"
import type { Team } from "./schemas"

export type QuestLiveStats = {
	done: number
	total: number
	completedBy: string[]
	hintRevealers: Record<string, string[]>
}

type QuestStatsTeam = Pick<Team, "name" | "questOrder" | "progress">
type QuestStatsSeason = { arcs: { quests: { id: string }[] }[] }

export function questLiveStats(season: QuestStatsSeason, teams: QuestStatsTeam[]): Record<string, QuestLiveStats> {
	return Object.fromEntries(
		season.arcs.flatMap((arc) =>
			arc.quests.map((quest) => {
				const completedBy = teams
					.flatMap((team) => {
						const solvedAt = team.progress.reduce<Date | undefined>((earliest, progress) => {
							if (progress.questId !== quest.id || !progress.solvedAt) return earliest
							return !earliest || progress.solvedAt.getTime() < earliest.getTime() ? progress.solvedAt : earliest
						}, undefined)
						return solvedAt ? [{ name: team.name, solvedAt }] : []
					})
					.toSorted((a, b) => a.solvedAt.getTime() - b.solvedAt.getTime())

				return [
					quest.id,
					{
						done: completedBy.length,
						total: teams.filter((team) => team.questOrder.length === 0 || team.questOrder.includes(quest.id)).length,
						completedBy: completedBy.map(({ name }) => name),
						hintRevealers: hintRevealers(teams, quest.id),
					},
				]
			}),
		),
	)
}
