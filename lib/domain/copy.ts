import { seasonStatus } from "./admin-seasons"
import { Arc, Quest, type Season } from "./schemas"

export function copyQuest(quest: Quest): Quest {
	const copiedQuest = structuredClone(quest)
	delete copiedQuest.hidden
	return Quest.parse({
		...copiedQuest,
		id: crypto.randomUUID(),
		hints: copiedQuest.hints.map((hint) => ({ ...hint, id: crypto.randomUUID() })),
	})
}

export function copyArc(arc: Arc): Arc {
	return Arc.parse({
		...arc,
		id: crypto.randomUUID(),
		quests: arc.quests.map(copyQuest),
	})
}

export function copyDestinations(seasons: readonly Season[], sourceSeasonId: string, now: Date) {
	const destinations = seasons.flatMap((season) => {
		if (season._id === sourceSeasonId) return []
		const status = seasonStatus(season, now)
		if (status !== "upcoming" && status !== "unscheduled") return []
		return [
			{
				id: season._id,
				title: season.title,
				status,
				start: season.start,
				arcs: season.arcs.map(({ id, title }) => ({ id, title })),
			},
		]
	})

	return destinations.sort(
		(a, b) =>
			(a.status === "upcoming" ? 0 : 1) - (b.status === "upcoming" ? 0 : 1) ||
			(a.status === "upcoming"
				? (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0)
				: a.title.localeCompare(b.title, "en")),
	)
}
