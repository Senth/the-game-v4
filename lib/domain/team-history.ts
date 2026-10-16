import { lifecycleState, type PaceBand, pace, paceLabel, questCounts } from "./game"
import type { Quest, Season, Team, TeamQuestProgress } from "./schemas"
import { teamHintLoss } from "./scoring"
import { questLabel } from "./season-tree"

export type TeamHistoryState =
	| { kind: "running"; band: PaceBand; label: string }
	| { kind: "before" | "ended" | "finished" }

function historyHints(progress: TeamQuestProgress | undefined, quest?: Quest) {
	return (progress?.hintsRevealed ?? [])
		.map((snapshot) => ({ snapshot, position: quest?.hints.findIndex((hint) => hint.id === snapshot.hintId) ?? -1 }))
		.toSorted((a, b) => {
			if (a.position === -1 && b.position === -1)
				return a.snapshot.revealedAt.getTime() - b.snapshot.revealedAt.getTime()
			if (a.position === -1) return 1
			if (b.position === -1) return -1
			return a.position - b.position
		})
		.map(({ snapshot, position }) => ({
			hintId: snapshot.hintId,
			label: position === -1 ? "H?" : `H${position + 1}`,
			text: snapshot.text,
			points: snapshot.points,
		}))
}

export function teamHistory(
	season: Pick<Season, "start" | "end" | "arcs">,
	team: Pick<Team, "score" | "questOrder" | "questIndex" | "progress" | "completed">,
	now: Date,
) {
	const lifecycle = lifecycleState(season, team, now)
	const before = lifecycle === "waiting" || lifecycle === "countdown"
	const teamPace = lifecycle === "running" ? pace(season, team, now) : null
	const state: TeamHistoryState = before
		? { kind: "before" }
		: lifecycle === "completed"
			? { kind: "finished" }
			: lifecycle === "ended"
				? { kind: "ended" }
				: {
						kind: "running",
						band: teamPace?.band ?? "pace-ok",
						label: teamPace?.n ? `${paceLabel(teamPace.n)} ${teamPace.n < 0 ? "of pace" : "pace"}` : paceLabel(0),
					}
	const progressByQuest = new Map(team.progress.map((entry) => [entry.questId, entry]))
	const questIds = new Set(season.arcs.flatMap((arc) => arc.quests.map((quest) => quest.id)))
	return {
		stats: { score: team.score, ...questCounts(team), hintLoss: teamHintLoss(team), state },
		arcs: season.arcs.map((arc) => ({
			id: arc.id,
			title: arc.title,
			quests: arc.quests.map((quest) => {
				const progress = progressByQuest.get(quest.id)
				const status: "solved" | "current" | "stopped" | "todo" = before
					? "todo"
					: progress?.solvedAt
						? "solved"
						: !team.completed && quest.id === team.questOrder[team.questIndex]
							? lifecycle === "ended"
								? "stopped"
								: "current"
							: "todo"
				return {
					id: quest.id,
					label: questLabel(quest),
					status,
					pointsEarned: progress?.pointsEarned ?? 0,
					hints: historyHints(progress, quest),
				}
			}),
		})),
		removed: team.progress
			.filter((entry) => !questIds.has(entry.questId))
			.map((entry) => ({
				questId: entry.questId,
				solved: !!entry.solvedAt,
				pointsEarned: entry.pointsEarned,
				hints: historyHints(entry),
			})),
	}
}
