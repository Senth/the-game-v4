import { describe, expect, it } from "vitest"
import { Hint, Quest, Season, type SeasonInput, Team, withHintIds } from "./schemas"

const draftQuest = {
	id: "q1",
	displayTitle: "Beacon",
	internalTitle: "beacon",
	content: "",
	assetPath: null,
	answers: [],
	points: null,
	adminNotes: "",
	hints: [],
}

describe("Quest", () => {
	it.each([null, 0, 10000])("accepts points %j", (points) => {
		expect(Quest.parse({ ...draftQuest, points }).points).toBe(points)
	})

	it.each([-1, 10001, 2.5, Number.NaN, Number.POSITIVE_INFINITY, "50"])("rejects points %j", (points) => {
		expect(Quest.safeParse({ ...draftQuest, points }).success).toBe(false)
	})

	it("accepts a draft with empty content, no answers and no points", () => {
		expect(Quest.safeParse(draftQuest).success).toBe(true)
	})

	it("rejects a quest without id", () => {
		const { id: _, ...withoutId } = draftQuest
		expect(Quest.safeParse(withoutId).success).toBe(false)
	})
})

describe("Hint", () => {
	it.each([0, 10000])("accepts points %i", (points) => {
		expect(Hint.parse({ id: "h1", text: "Look north", points }).points).toBe(points)
	})

	it.each([-3, 10001, 2.5, Number.NaN, Number.POSITIVE_INFINITY, "5"])("rejects points %j", (points) => {
		expect(Hint.safeParse({ id: "h1", text: "Look north", points }).success).toBe(false)
	})

	it("rejects a stored hint without id", () => {
		expect(Hint.safeParse({ text: "Look north", points: 5 }).success).toBe(false)
	})
})

describe("withHintIds", () => {
	const input: SeasonInput = {
		_id: "s1",
		title: "Cipher Night",
		lengthMinutes: 120,
		start: null,
		end: null,
		shuffleArcs: false,
		registrationOpen: false,
		arcs: [
			{
				id: "a1",
				title: "Lighthouse",
				shuffleQuests: false,
				quests: [
					{
						...draftQuest,
						hints: [
							{ text: "First", points: 5 },
							{ id: "kept", text: "Second", points: 10 },
							{ text: "Third", points: 15 },
						],
					},
				],
			},
		],
	}

	it("assigns unique ids only where missing and leaves the input unchanged", () => {
		const original = structuredClone(input)
		const hints = withHintIds(input).arcs[0]?.quests[0]?.hints ?? []
		const ids = hints.map((hint) => hint.id)

		expect(ids[1]).toBe("kept")
		expect(ids.every((hintId) => hintId.length > 0)).toBe(true)
		expect(new Set(ids).size).toBe(3)
		expect(input).toEqual(original)
	})
})

describe("Season", () => {
	it.each([0, -1, 1.5, 1441, Number.NaN, Number.POSITIVE_INFINITY, "60", null])(
		"rejects invalid lengthMinutes %j",
		(lengthMinutes) => {
			const stored = { _id: "s1", title: "Old", lengthMinutes, start: null, end: null, shuffleArcs: false, arcs: [] }
			expect(Season.safeParse(stored).success).toBe(false)
		},
	)

	it.each([1, 60, 1440])("accepts whole-minute lengthMinutes %i", (lengthMinutes) => {
		const stored = { _id: "s1", title: "Old", lengthMinutes, start: null, end: null, shuffleArcs: false, arcs: [] }
		expect(Season.parse(stored).lengthMinutes).toBe(lengthMinutes)
	})

	it("reads a stored season without registrationOpen as closed", () => {
		const stored = { _id: "s1", title: "Old", lengthMinutes: 60, start: null, end: null, shuffleArcs: false, arcs: [] }
		expect(Season.parse(stored).registrationOpen).toBe(false)
		expect(Season.parse(stored)).toMatchObject({ finisherBonuses: [], finishers: [] })
	})

	it.each([null, 0, 10000])("accepts default quest points %j", (points) => {
		const stored = {
			_id: "s1",
			title: "Old",
			lengthMinutes: 60,
			start: null,
			end: null,
			shuffleArcs: false,
			defaultQuestPoints: points,
			arcs: [],
		}
		expect(Season.parse(stored).defaultQuestPoints).toBe(points)
	})

	it.each([-1, 10001, 2.5, "30"])("rejects invalid default quest points %j", (points) => {
		const stored = {
			_id: "s1",
			title: "Old",
			lengthMinutes: 60,
			start: null,
			end: null,
			shuffleArcs: false,
			defaultQuestPoints: points,
			arcs: [],
		}
		expect(Season.safeParse(stored).success).toBe(false)
	})

	it("reads a stored season without default quest points as null", () => {
		const stored = { _id: "s1", title: "Old", lengthMinutes: 60, start: null, end: null, shuffleArcs: false, arcs: [] }
		expect(Season.parse(stored).defaultQuestPoints).toBeNull()
	})

	it.each([-1, 10001, 1.5, "50"])("rejects invalid finisher bonus %j", (points) => {
		expect(Season.shape.finisherBonuses.safeParse([points]).success).toBe(false)
	})

	it("accepts whole-number finisher bonuses including zero", () => {
		expect(Season.shape.finisherBonuses.parse([0, 50, 10000])).toEqual([0, 50, 10000])
	})
})

describe("Team", () => {
	it("accepts an assigned season, an unsolved progress entry and a negative score", () => {
		const team = {
			_id: "t1",
			name: "Ninjas",
			passwordHash: "$2b$10$hash",
			seasonId: "s1",
			questOrder: ["q1"],
			questIndex: 0,
			score: -15,
			completed: false,
			progress: [{ questId: "q1", hintsRevealed: [], pointsEarned: 0 }],
		}
		expect(Team.safeParse(team).success).toBe(true)
	})

	it("rejects a missing season id", () => {
		const team = {
			_id: "t1",
			name: "Ninjas",
			passwordHash: "$2b$10$hash",
			seasonId: null,
			questOrder: [],
			questIndex: 0,
			score: 0,
			completed: false,
			progress: [],
		}
		expect(Team.safeParse(team).success).toBe(false)
	})
})
