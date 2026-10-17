import type { Quest } from "./schemas"

export function playableArcs<T extends { quests: { id: string; hidden?: boolean }[] }>(season: { arcs: T[] }): T[] {
	return season.arcs.map((arc) => ({ ...arc, quests: arc.quests.filter((quest) => !quest.hidden) }))
}

export function missingForGame(quest: Pick<Quest, "displayTitle" | "content" | "answers" | "points">): string[] {
	const missing: string[] = []
	if (!quest.displayTitle.trim()) missing.push("display title")
	if (!quest.content.trim()) missing.push("content")
	if (quest.answers.length === 0) missing.push("answers")
	if (quest.points === null) missing.push("points")
	return missing
}
