import { describe, expect, it } from "vitest"
import { Hint, Quest, type SeasonInput, Team, withHintIds } from "./schemas"

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
	it("accepts a draft with empty content, no answers and no points", () => {
		expect(Quest.safeParse(draftQuest).success).toBe(true)
	})

	it("rejects a quest without id", () => {
		const { id: _, ...withoutId } = draftQuest
		expect(Quest.safeParse(withoutId).success).toBe(false)
	})
})

describe("Hint", () => {
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

describe("Team", () => {
	it("accepts no season, an unsolved progress entry and a negative score", () => {
		const team = {
			_id: "t1",
			name: "Ninjas",
			passwordHash: "$2b$10$hash",
			seasonId: null,
			questOrder: ["q1"],
			questIndex: 0,
			score: -15,
			completed: false,
			progress: [{ questId: "q1", hintsRevealed: [], pointsEarned: 0 }],
		}
		expect(Team.safeParse(team).success).toBe(true)
	})
})
