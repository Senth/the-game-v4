"use client"

import { useSelectedLayoutSegments } from "next/navigation"
import type { Season } from "@/lib/domain/schemas"
import { QuestPreview } from "./quest-preview"

export function SeasonPreview({
	season,
	now,
}: {
	season: Pick<Season, "start" | "end" | "lengthMinutes" | "arcs">
	now: number
}) {
	const [segment, questId] = useSelectedLayoutSegments()
	const arc =
		segment === "quests" ? season.arcs.find((arc) => arc.quests.some((quest) => quest.id === questId)) : undefined
	const quest = arc?.quests.find((quest) => quest.id === questId)
	return arc && quest ? (
		<QuestPreview key={quest.id} season={season} arcId={arc.id} quest={quest} now={now} frame />
	) : (
		<>
			<h2 className="font-cond text-xs uppercase tracking-wider text-muted">Player preview</h2>
			<p className="mt-3 font-cond text-sm text-muted">Open a quest or team to preview it.</p>
		</>
	)
}
