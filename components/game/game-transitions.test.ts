import { describe, expect, it } from "vitest"
import type { PlayerGame } from "@/lib/domain/player-game"
import { gamePlaceholder, gameTransitions } from "./game-transitions"

const running: Extract<PlayerGame, { lifecycleState: "running" }> = {
	lifecycleState: "running",
	quest: {
		id: "log",
		displayTitle: "The log",
		content: "Read the log.",
		assetPath: null,
		points: 50,
		worth: 45,
		hints: [
			{ id: "first", position: 1, points: 5, text: "Start from the bottom.", revealed: true },
			{ id: "second", position: 2, points: 10, revealed: false },
		],
	},
	score: 64,
	solved: 5,
	total: 12,
	start: new Date("2026-10-10T18:00:00Z"),
	end: new Date("2026-10-10T20:00:00Z"),
	pace: { band: "pace-ok", label: "On pace" },
	rail: [
		{
			arcId: "lighthouse",
			segments: [
				{ questId: "log", state: "current" },
				{ questId: "horn", state: "todo" },
			],
		},
	],
	strip: [],
}

describe("gameTransitions", () => {
	it("finds only hints that flipped from locked to revealed on the same quest", () => {
		const next = structuredClone(running)
		if (!next.quest) throw new Error("Missing test quest")
		next.quest.hints[1] = { id: "second", position: 2, points: 10, text: "Read backwards.", revealed: true }
		next.quest.hints.push({ id: "new", position: 3, points: 20, text: "Already revealed.", revealed: true })
		expect(gameTransitions(running, next)).toEqual({
			questChanged: false,
			revealedHintIds: ["second"],
			solvedQuestId: null,
		})
		expect(running.quest?.hints[1]?.revealed).toBe(false)
	})

	it("does not replay existing reveals or restart on a text edit/reorder", () => {
		const next = structuredClone(running)
		if (!next.quest) throw new Error("Missing test quest")
		next.quest.hints.reverse()
		next.quest.hints[1] = { id: "first", position: 2, points: 5, text: "Edited text.", revealed: true }
		expect(gameTransitions(running, next).revealedHintIds).toEqual([])
	})

	it("clears the input on a solved quest change and reports teammate success", () => {
		const next = structuredClone(running)
		if (!next.quest) throw new Error("Missing test quest")
		next.quest.id = "horn"
		next.rail = [
			{
				arcId: "lighthouse",
				segments: [
					{ questId: "log", state: "solved" },
					{ questId: "horn", state: "current" },
				],
			},
		]
		expect(gameTransitions(running, next)).toEqual({ questChanged: true, revealedHintIds: [], solvedQuestId: "log" })
	})

	it("clears the input on a deleted/skipped quest change without success", () => {
		const next = structuredClone(running)
		if (!next.quest) throw new Error("Missing test quest")
		next.quest.id = "horn"
		next.rail = [{ arcId: "lighthouse", segments: [{ questId: "horn", state: "current" }] }]
		expect(gameTransitions(running, next)).toEqual({ questChanged: true, revealedHintIds: [], solvedQuestId: null })
	})

	it("preserves the input when only score, pace or quest content changes", () => {
		const next = structuredClone(running)
		next.score++
		next.pace = { band: "pace-1", label: "1 behind" }
		if (next.quest) next.quest.content = "An edited clue."
		expect(gameTransitions(running, next).questChanged).toBe(false)
	})

	it("does not scramble reveals carried by a different quest", () => {
		const next = structuredClone(running)
		if (next.quest) next.quest.id = "horn"
		expect(gameTransitions(running, next).revealedHintIds).toEqual([])
	})

	it.each<PlayerGame>([
		{ lifecycleState: "ended", score: 64 },
		{ lifecycleState: "completed", score: 64 },
		{ ...running, quest: null },
	])("clears the input when running quest disappears: $lifecycleState", (next) => {
		expect(gameTransitions(running, next).questChanged).toBe(true)
		expect(gameTransitions(running, next).solvedQuestId).toBeNull()
	})
})

describe("gamePlaceholder", () => {
	it("keeps non-running states to one sentence/line until lifecycle UI lands", () => {
		expect(gamePlaceholder({ lifecycleState: "waiting" })).toBe("Waiting for the game.")
		expect(gamePlaceholder({ lifecycleState: "countdown", start: running.start })).toBe("The game starts soon.")
		expect(gamePlaceholder({ lifecycleState: "completed", score: 64 })).toBe("Completed. 64p.")
		expect(gamePlaceholder({ lifecycleState: "ended", score: -5 })).toBe("Game ended. -5p.")
	})
})
