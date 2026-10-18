import type { Quest, Season } from "./schemas"

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

export function missingLabel(missing: readonly string[]): string {
	return missing.length > 1
		? `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`
		: (missing[0] ?? "")
}

export function incompleteQuests(season: Pick<Season, "arcs">) {
	return season.arcs.flatMap((arc) =>
		arc.quests.flatMap((quest) => {
			const missing = missingForGame(quest)
			return missing.length
				? [
						{
							id: quest.id,
							label: quest.internalTitle.trim() || quest.displayTitle.trim() || "Untitled quest",
							missing,
						},
					]
				: []
		}),
	)
}
