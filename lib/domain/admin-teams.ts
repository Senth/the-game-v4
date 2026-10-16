import { seasonStatus } from "./admin-seasons"
import { currentQuest, type RailArc, rail, rankTeams } from "./game"
import type { Season, Team } from "./schemas"
import { teamHintLoss } from "./scoring"
import { questLabel } from "./season-tree"

export type AdminTeamRow = {
	id: string
	name: string
	score: number
	hintLoss: number
	rank: number | null
	rail: RailArc[]
	status: { kind: "before" } | { kind: "on" | "stopped"; quest: string } | { kind: "finished" }
}

export function adminTeamRows(
	season: Season,
	teams: Pick<Team, "_id" | "name" | "score" | "progress" | "questOrder" | "questIndex" | "completed">[],
	now: Date,
): AdminTeamRow[] {
	const state = seasonStatus(season, now)
	const before = state === "unscheduled" || state === "upcoming"
	const ordered = before
		? teams.toSorted((a, b) => a.name.localeCompare(b.name)).map((team) => ({ ...team, rank: null }))
		: rankTeams(teams)
	return ordered.map((team) => {
		const current = currentQuest(season, team)
		const status: AdminTeamRow["status"] = before
			? { kind: "before" }
			: team.completed
				? { kind: "finished" }
				: current
					? { kind: state === "ended" ? "stopped" : "on", quest: questLabel(current.quest) ?? "Untitled quest" }
					: { kind: "before" }
		return {
			id: team._id,
			name: team.name,
			score: team.score,
			hintLoss: teamHintLoss(team),
			rank: team.rank,
			rail: rail(season, team).map(({ arcId, segments }) => ({
				arcId,
				segments: segments.map(({ questId, state: segment }) => ({
					questId,
					state: before || (segment === "current" && state !== "live") ? "todo" : segment,
				})),
			})),
			status,
		}
	})
}
