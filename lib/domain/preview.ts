import { type PuzzleAssets, playerView, rail } from "./game"
import { randomSpread } from "./puzzle"
import type { Quest, Season } from "./schemas"

export function previewGame(
	season: Pick<Season, "start" | "end" | "lengthMinutes" | "arcs">,
	quest: Quest,
	now: Date,
	puzzleAssets?: PuzzleAssets,
) {
	let seed = 0
	for (const char of quest.id) seed = (Math.imul(seed, 31) + char.charCodeAt(0)) >>> 0
	const progress = quest.puzzle
		? {
				questId: quest.id,
				hintsRevealed: [],
				pointsEarned: 0,
				puzzle: {
					version: 0,
					spots: randomSpread(quest.puzzle.rows * quest.puzzle.cols, () => {
						seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
						return seed / 0x100000000
					}),
				},
			}
		: undefined
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
		quest: playerView(quest, progress, puzzleAssets),
	}
}
