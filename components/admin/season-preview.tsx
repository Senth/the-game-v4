"use client"

import { useSelectedLayoutSegments } from "next/navigation"
import type { Season, Team } from "@/lib/domain/schemas"
import { QuestPreview } from "./quest-preview"
import { TeamPreview } from "./team-preview"
import { useSeasonClock } from "./use-season-clock"

export function SeasonPreview({
	season,
	teams,
	now,
}: {
	season: Pick<Season, "start" | "end" | "lengthMinutes" | "arcs" | "finishers">
	teams: Omit<Team, "passwordHash">[]
	now: number
}) {
	const [segment, questId] = useSelectedLayoutSegments()
	const clock = useSeasonClock(now, season.start, season.end)
	const arc =
		segment === "quests" ? season.arcs.find((arc) => arc.quests.some((quest) => quest.id === questId)) : undefined
	const quest = arc?.quests.find((quest) => quest.id === questId)
	const team = segment === "teams" ? teams.find((team) => team._id === questId) : undefined
	if (team) return <TeamPreview key={team._id} season={season} team={team} teams={teams} now={clock} />
	return arc && quest ? (
		<QuestPreview key={quest.id} season={season} arcId={arc.id} quest={quest} now={clock} frame />
	) : (
		<>
			<h2 className="font-cond text-xs uppercase tracking-wider text-muted">Player preview</h2>
			<p className="mt-3 font-cond text-sm text-muted">Open a quest or team to preview it.</p>
		</>
	)
}
