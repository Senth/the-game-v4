import { describe, expect, it } from "vitest"
import { incompleteQuests, missingForGame, missingLabel, playableArcs } from "./playable-quests"
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
	const complete = { displayTitle: "Title", content: "Content", assetPath: null, answers: ["answer"], points: 10 }

	it.each(["jpg", "png", "webp", "gif", "svg"])("accepts an image puzzle with optional answers: %s", (extension) => {
		for (const answers of [[], ["answer"]]) {
			expect(
				missingForGame({
					...complete,
					content: "",
					assetPath: `/assets/clue.${extension}`,
					answers,
					puzzle: { rows: 4, cols: 4, showFull: false },
					points: 0,
				}),
			).toEqual([])
		}
	})

	it.each([null, "", " ", "/assets/clue.pdf", "/assets/clue.file.png"])(
		"requires an image for a puzzle: %j",
		(assetPath) => {
			expect(
				missingForGame({
					...complete,
					assetPath,
					answers: [],
					points: null,
					puzzle: { rows: 4, cols: 4, showFull: false },
				}),
			).toEqual(["an image", "points"])
		},
	)

	it("lists missing fields in display order without changing inputs", () => {
		const quest = newQuest()
		const original = structuredClone(quest)
		expect(missingForGame(quest)).toEqual(["content", "answers", "points"])
		expect(quest).toEqual(original)
	})

	it.each([
		{ field: "content", quest: { ...complete, content: " \t\n" } },
		{ field: "answers", quest: { ...complete, answers: [] } },
		{ field: "points", quest: { ...complete, points: null } },
	])("identifies missing $field", ({ field, quest }) => {
		expect(missingForGame(quest)).toEqual([field])
	})

	it.each([0, 10, 10000])("accepts a complete quest with %i points", (points) => {
		expect(missingForGame({ ...complete, points })).toEqual([])
	})

	it.each(["", " \t\n"])("accepts content-only and asset-only quests without a display title %j", (displayTitle) => {
		const quest = { ...complete, displayTitle }
		expect(missingForGame(quest)).toEqual([])
		for (const assetPath of ["/assets/clue.png", "/assets/clue.pdf"]) {
			expect(missingForGame({ ...quest, content: " \t\n", assetPath })).toEqual([])
		}
	})

	it("still requires content when both content and asset path are whitespace", () => {
		expect(missingForGame({ ...complete, content: " \n", assetPath: " \t" })).toEqual(["content"])
	})
})

describe("missingLabel", () => {
	it.each([
		{ missing: [], expected: "" },
		{ missing: ["answers"], expected: "answers" },
		{ missing: ["content", "answers"], expected: "content and answers" },
		{
			missing: ["content", "answers", "points"],
			expected: "content, answers and points",
		},
	])("joins missing fields as $expected", ({ missing, expected }) => {
		expect(missingLabel(missing)).toBe(expected)
	})
})

describe("incompleteQuests", () => {
	it("lists incomplete quests in authored order, includes hidden drafts and leaves inputs unchanged", () => {
		const season = {
			arcs: [
				{
					id: "a1",
					title: "Arc",
					shuffleQuests: false,
					quests: [
						{ ...newQuest(), id: "fresh" },
						{
							...newQuest(),
							id: "answers",
							internalTitle: " Internal answers ",
							displayTitle: "Display answers",
							content: "Content",
							points: 10,
						},
						{
							...newQuest(),
							id: "whitespace",
							displayTitle: "Whitespace",
							content: " \t\n ",
							answers: ["answer"],
							points: 10,
						},
						{
							...newQuest(),
							id: "zero-points",
							displayTitle: "Zero points",
							content: "Content",
							answers: ["answer"],
							points: 0,
						},
						{
							...newQuest(),
							id: "image-only",
							assetPath: "/assets/clue.png",
							answers: ["answer"],
							points: 10,
						},
						{
							...newQuest(),
							id: "hidden",
							displayTitle: "Hidden draft",
							content: "Content",
							answers: [],
							points: 0,
							hidden: true,
						},
					],
				},
			],
		}
		const original = structuredClone(season)

		expect(incompleteQuests(season)).toEqual([
			{ id: "fresh", label: "Untitled quest", missing: ["content", "answers", "points"] },
			{ id: "answers", label: "Internal answers", missing: ["answers"] },
			{ id: "whitespace", label: "Whitespace", missing: ["content"] },
			{ id: "hidden", label: "Hidden draft", missing: ["answers"] },
		])
		expect(season).toEqual(original)
	})
})
