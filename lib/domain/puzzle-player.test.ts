import { describe, expect, it } from "vitest"
import { buildFixture } from "@/scripts/fixture"
import { playerView } from "./game"
import { playerGame } from "./player-game"
import { previewGame } from "./preview"
import { pieceIds, randomSpread } from "./puzzle"

const now = new Date("2026-10-09T18:00:00Z")
const { season, teams } = buildFixture(now)
const base = season.arcs[0]?.quests[0]
const team = teams.find((entry) => entry._id === "team-ninjas")
if (!base || !team) throw new Error("Fixture quest or team missing")
const quest = { ...base, drop: null, puzzle: { rows: 2, cols: 2, showFull: false }, answers: [] }
const progress = {
	questId: quest.id,
	hintsRevealed: [],
	pointsEarned: 0,
	puzzle: { version: 3, spots: [{ cell: 2 }, { x: 0.2, y: 0.8 }, { cell: 1 }, { x: 0, y: 1 }] },
}

describe("puzzle player boundary", () => {
	it.each([false, true])("exposes sorted opaque pieces and guards full picture with showFull=%s", async (showFull) => {
		const authored = { ...quest, puzzle: { ...quest.puzzle, showFull } }
		const puzzleSeason = {
			...season,
			arcs: [{ ...season.arcs[0], id: "arc", title: "Arc", shuffleQuests: false, quests: [authored] }],
		}
		const puzzleTeam = { ...team, questOrder: [quest.id], questIndex: 0, progress: [progress] }
		const before = structuredClone({ puzzleSeason, puzzleTeam })
		const ids = await pieceIds(quest.id, quest.assetPath ?? "", 2, 2, "secret")
		const assets = { ids, aspect: 1.5, fullUrl: `/api/puzzle/${quest.id}/full` }
		const view = playerView(authored, progress, assets)
		expect(view).not.toHaveProperty("assetPath")
		expect(view.puzzle).toEqual({
			rows: 2,
			cols: 2,
			aspect: 1.5,
			pieces: ids
				.map((id, index) => ({ id, spot: progress.puzzle.spots[index] }))
				.sort((a, b) => (a.id < b.id ? -1 : 1)),
			fullUrl: showFull ? assets.fullUrl : null,
		})
		expect(view.puzzle?.pieces.map(({ id }) => id)).not.toEqual(ids)
		const game = playerGame(puzzleSeason, puzzleTeam, [puzzleTeam], now, assets)
		expect(game).toHaveProperty("quest", view)
		const json = JSON.stringify(game)
		for (const key of [
			"assetPath",
			"answers",
			"adminNotes",
			"internalTitle",
			"index",
			"correct",
			quest.assetPath ?? "private",
		])
			expect(json).not.toContain(key)
		if (!showFull) expect(json).not.toContain(assets.fullUrl)
		expect({ puzzleSeason, puzzleTeam }).toEqual(before)
	})

	it("never falls back to the original asset when state or tile metadata is absent", () => {
		for (const view of [playerView(quest), playerView(quest, progress)]) {
			expect(view).not.toHaveProperty("assetPath")
			expect(view.puzzle).toBeNull()
		}
	})

	it("leaves regular quest projection unchanged", () => {
		expect(playerView(base)).toHaveProperty("assetPath", base.assetPath)
		expect(playerView(base)).not.toHaveProperty("puzzle")
	})

	it("rejects mismatched piece metadata instead of exposing a partial board", () => {
		expect(() => playerView(quest, progress, { ids: ["only-one"], aspect: 1, fullUrl: "/full" })).toThrow(
			"Puzzle piece metadata does not match board",
		)
	})

	it("creates deterministic all-loose previews from quest id, not clock or team state", async () => {
		const ids = await pieceIds(quest.id, quest.assetPath ?? "", 2, 2, "secret")
		const assets = { ids, aspect: 1.5, fullUrl: `/api/puzzle/${quest.id}/full` }
		const before = structuredClone({ season, quest })
		const first = previewGame(season, quest, now, assets).quest
		const later = previewGame(season, quest, new Date(now.getTime() + 1000), assets).quest
		expect(first).toEqual(later)
		expect(first.puzzle?.pieces).toHaveLength(4)
		expect(first.puzzle?.pieces.every(({ spot }) => "x" in spot)).toBe(true)
		expect(first.puzzle?.pieces.map(({ spot }) => spot)).not.toEqual(randomSpread(4, () => 0))
		expect(previewGame(season, { ...quest, id: "another" }, now, assets).quest.puzzle?.pieces).not.toEqual(
			first.puzzle?.pieces,
		)
		expect(first).not.toHaveProperty("assetPath")
		expect(first.puzzle?.fullUrl).toBeNull()
		expect({ season, quest }).toEqual(before)
	})
})
