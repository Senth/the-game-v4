import { describe, expect, it } from "vitest"
import { Arc, Quest, type Season } from "./schemas"
import { canEditStructure, newArc, newQuest, questLabel, treeView } from "./season-tree"

const now = new Date("2026-10-13T12:00:00Z")

describe("newArc", () => {
	it.each([false, true])("creates a valid arc with shuffleQuests %s", (shuffleArcs) => {
		const arc = newArc(shuffleArcs)

		expect(Arc.safeParse(arc).success).toBe(true)
		expect(arc).toEqual({ id: expect.any(String), title: "New arc", shuffleQuests: shuffleArcs, quests: [] })
	})

	it("assigns a fresh id each time", () => {
		expect(newArc(false).id).not.toBe(newArc(false).id)
	})
})

describe("newQuest", () => {
	it("creates a valid draft with a fresh id", () => {
		const quest = newQuest()

		expect(Quest.safeParse(quest).success).toBe(true)
		expect(quest).toEqual({
			id: expect.any(String),
			displayTitle: "",
			internalTitle: "",
			content: "",
			assetPath: null,
			answers: [],
			points: null,
			adminNotes: "",
			hints: [],
		})
		expect(newQuest().id).not.toBe(quest.id)
	})
})

describe("questLabel", () => {
	it.each([
		{ internalTitle: "Internal", displayTitle: "Display", expected: "Internal" },
		{ internalTitle: " Internal ", displayTitle: " Display ", expected: "Internal" },
		{ internalTitle: " \t\n ", displayTitle: " Display ", expected: "Display" },
		{ internalTitle: " \t ", displayTitle: "\n ", expected: null },
	])(
		"prefers trimmed internal title, then trimmed display title: $expected",
		({ internalTitle, displayTitle, expected }) => {
			expect(questLabel({ internalTitle, displayTitle })).toBe(expected)
		},
	)
})

describe("canEditStructure", () => {
	it.each([
		{ start: null, end: null, expected: true },
		{ start: new Date(now.getTime() + 1), end: null, expected: true },
		{ start: now, end: new Date(now.getTime() + 1), expected: false },
		{ start: new Date(now.getTime() - 1), end: null, expected: false },
		{ start: new Date(now.getTime() - 1), end: now, expected: false },
	])("returns $expected at start $start and end $end", ({ start, end, expected }) => {
		const season = { start, end }
		const original = structuredClone({ season, now })

		expect(canEditStructure(season, now)).toBe(expected)
		expect({ season, now }).toEqual(original)
	})
})

describe("treeView", () => {
	it("returns minimal quest labels and points without mutating the season", () => {
		const season: Season = {
			_id: "s1",
			title: "Season",
			lengthMinutes: 60,
			start: null,
			end: null,
			shuffleArcs: false,
			registrationOpen: false,
			arcs: [
				{
					id: "a1",
					title: "Arc",
					shuffleQuests: true,
					quests: [
						{
							id: "q1",
							displayTitle: " Display ",
							internalTitle: " Internal ",
							content: "private content",
							assetPath: "private asset",
							answers: ["secret"],
							points: null,
							adminNotes: "private notes",
							hints: [{ id: "h1", text: "private hint", points: 5 }],
							hidden: true,
						},
						{
							id: "q2",
							displayTitle: " Display only ",
							internalTitle: "  ",
							content: "",
							assetPath: null,
							answers: [],
							points: 20,
							adminNotes: "",
							hints: [],
						},
					],
				},
			],
		}
		const original = structuredClone(season)
		const view = treeView(season)

		expect(view).toEqual({
			arcs: [
				{
					id: "a1",
					title: "Arc",
					shuffleQuests: true,
					hintCount: 1,
					quests: [
						{ id: "q1", label: "Internal", points: null, hidden: true },
						{ id: "q2", label: "Display only", points: 20 },
					],
				},
			],
		})
		expect(Object.keys(view.arcs[0] ?? {}).sort()).toEqual(["hintCount", "id", "quests", "shuffleQuests", "title"])
		expect(Object.keys(view.arcs[0]?.quests[0] ?? {}).sort()).toEqual(["hidden", "id", "label", "points"])
		expect(JSON.stringify(view)).not.toMatch(/answers|content|adminNotes|hints|assetPath/)
		expect(season).toEqual(original)
	})
})
