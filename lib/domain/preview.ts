import { playerView, rail } from "./game"
import type { Quest, Season } from "./schemas"

export function previewGame(season: Pick<Season, "start" | "end" | "lengthMinutes" | "arcs">, quest: Quest, now: Date) {
	const timeLeftMs =
		!season.start || now < season.start
			? season.lengthMinutes * 60_000
			: season.end
				? Math.max(0, season.end.getTime() - now.getTime())
				: 0
	return {
		preview: true as const,
		timeLeftMs,
		pace: null,
		rail: rail(season, { questOrder: [quest.id], questIndex: 0, progress: [] }),
		quest: playerView(quest),
	}
}
