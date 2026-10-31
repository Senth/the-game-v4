import { currentQuest } from "./game"
import type { Season, Team } from "./schemas"

export type LivePlace = { lat: number; lng: number; radius: number; number: number; teamIds: string[] }

export function livePlaces(season: Pick<Season, "arcs">, teams: readonly Team[]): LivePlace[] {
	const places = new Map<string, LivePlace>()
	for (const team of teams.toSorted((a, b) => a.name.localeCompare(b.name, "en"))) {
		if (team.completed) continue
		const quest = currentQuest(season, team)?.quest
		if (!quest?.location) continue
		for (const [index, place] of quest.location.places.entries()) {
			const key = JSON.stringify([quest.id, place.id])
			const existing = places.get(key)
			if (existing) existing.teamIds.push(team._id)
			else {
				const { lat, lng, radius } = place
				places.set(key, { lat, lng, radius, number: index + 1, teamIds: [team._id] })
			}
		}
	}
	return [...places.values()]
}

export function teamColor(index: number, count: number): string {
	return `hsl(${(index * 360) / count} 75% ${count > 10 && index % 2 === 1 ? 78 : 72}%)`
}
