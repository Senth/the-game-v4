import { describe, expect, it } from "vitest"
import { missingForGame, playableArcs } from "./playable-quests"
import { Quest } from "./schemas"
import { newQuest } from "./season-tree"

describe("playableArcs", () => {
	it("preserves authored arcs, empty arcs and visible quests without changing inputs", () => {
		const season = {
			arcs: [
				{ id: "a1", quests: [{ id: "legacy" }, { id: "visible", hidden: false }, { id: "draft", hidden: true }] },
				{ id: "a2", quests: [{ id: "only-draft", hidden: true }] },
				{ id: "empty", quests: [] },
			],
		}
		const original = structuredClone(season)
		expect(playableArcs(season)).toEqual([
			{ id: "a1", quests: [{ id: "legacy" }, { id: "visible", hidden: false }] },
			{ id: "a2", quests: [] },
			{ id: "empty", quests: [] },
		])
		expect(season).toEqual(original)
	})
})

describe("Quest hidden flag", () => {
	it("keeps new and existing quests visible by default", () => {
		expect(newQuest().hidden).toBeUndefined()
		expect(Quest.parse(newQuest())).not.toHaveProperty("hidden")
	})

	it.each([true, false])("preserves explicit hidden %s", (hidden) => {
		expect(Quest.parse({ ...newQuest(), hidden }).hidden).toBe(hidden)
	})

	it("rejects a non-boolean hidden flag", () => {
		expect(Quest.safeParse({ ...newQuest(), hidden: "true" }).success).toBe(false)
	})
})

describe("missingForGame", () => {
	const complete = { displayTitle: "Title", content: "Content", answers: ["answer"], points: 10 }

	it("lists missing fields in display order without changing inputs", () => {
		const quest = newQuest()
		const original = structuredClone(quest)
		expect(missingForGame(quest)).toEqual(["display title", "content", "answers", "points"])
		expect(quest).toEqual(original)
	})

	it.each([
		{ field: "display title", quest: { ...complete, displayTitle: " \t\n" } },
		{ field: "content", quest: { ...complete, content: " \t\n" } },
		{ field: "answers", quest: { ...complete, answers: [] } },
		{ field: "points", quest: { ...complete, points: null } },
	])("identifies missing $field", ({ field, quest }) => {
		expect(missingForGame(quest)).toEqual([field])
	})

	it.each([0, 10, 10000])("accepts a complete quest with %i points", (points) => {
		expect(missingForGame({ ...complete, points })).toEqual([])
	})
})
