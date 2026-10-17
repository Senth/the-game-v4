import { seasonStatus } from "./admin-seasons"
import { Arc, Quest, type Season } from "./schemas"

export function newArc(shuffleArcs: boolean): Arc {
	return Arc.parse({
		id: crypto.randomUUID(),
		title: "New arc",
		shuffleQuests: shuffleArcs,
		quests: [],
	})
}

export function newQuest(): Quest {
	return Quest.parse({
		id: crypto.randomUUID(),
		displayTitle: "",
		internalTitle: "",
		content: "",
		assetPath: null,
		answers: [],
		points: null,
		adminNotes: "",
		hints: [],
	})
}

export function questLabel(quest: Pick<Quest, "internalTitle" | "displayTitle">): string | null {
	return quest.internalTitle.trim() || quest.displayTitle.trim() || null
}

export function canEditStructure(season: Pick<Season, "start" | "end">, now: Date): boolean {
	const status = seasonStatus(season, now)
	return status === "unscheduled" || status === "upcoming"
}

export function treeView(season: Season) {
	return {
		arcs: season.arcs.map((arc) => ({
			id: arc.id,
			title: arc.title,
			shuffleQuests: arc.shuffleQuests,
			quests: arc.quests.map((quest) => ({
				id: quest.id,
				label: questLabel(quest),
				points: quest.points,
				...(quest.hidden ? { hidden: true } : {}),
			})),
		})),
	}
}
