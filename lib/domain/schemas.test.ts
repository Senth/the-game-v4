import { describe, expect, it } from "vitest"
import { Hint, Location, Place, Quest, Season, type SeasonInput, Team, withHintIds } from "./schemas"

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
	it("reads a legacy quest location as null without changing input", () => {
		const original = structuredClone(draftQuest)
		expect(Quest.parse(draftQuest).location).toBeNull()
		expect(Quest.parse({ ...draftQuest, location: null }).location).toBeNull()
		expect(draftQuest).toEqual(original)
	})

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
	it("reads legacy map area as null without changing input", () => {
		const stored = { _id: "s1", title: "Old", lengthMinutes: 60, start: null, end: null, shuffleArcs: false, arcs: [] }
		const original = structuredClone(stored)
		expect(Season.parse(stored).mapArea).toBeNull()
		expect(stored).toEqual(original)
	})

	it("accepts null map area and rounds coordinates and zoom", () => {
		expect(Season.shape.mapArea.parse(null)).toBeNull()
		expect(Season.shape.mapArea.parse({ lat: 55.5079126, lng: -13.2353126, zoom: 12.345 })).toEqual({
			lat: 55.507913,
			lng: -13.235313,
			zoom: 12.35,
		})
		for (const area of [
			{ lat: -90, lng: -180, zoom: 2 },
			{ lat: 90, lng: 180, zoom: 19 },
		]) {
			expect(Season.shape.mapArea.parse(area)).toEqual(area)
		}
	})

	it.each([
		{ lat: -90.000001 },
		{ lat: 90.000001 },
		{ lng: -180.000001 },
		{ lng: 180.000001 },
		{ zoom: 1.999 },
		{ zoom: 19.001 },
		{ lat: Number.NaN },
		{ lng: Number.POSITIVE_INFINITY },
		{ zoom: Number.POSITIVE_INFINITY },
		{ zoom: "12" },
	])("rejects invalid map area %j before rounding", (invalid) => {
		expect(Season.shape.mapArea.safeParse({ lat: 55.5, lng: 13.2, zoom: 12, ...invalid }).success).toBe(false)
	})

	it("reads legacy place radius as 40 without changing input", () => {
		const stored = { _id: "s1", title: "Old", lengthMinutes: 60, start: null, end: null, shuffleArcs: false, arcs: [] }
		const original = structuredClone(stored)
		expect(Season.parse(stored).placeRadius).toBe(40)
		expect(stored).toEqual(original)
	})

	it.each([5, 40, 500])("accepts place radius %i", (radius) => {
		expect(Season.shape.placeRadius.parse(radius)).toBe(radius)
	})

	it.each([4, 501, 40.5, null, "40", Number.NaN, Number.POSITIVE_INFINITY])("rejects place radius %j", (radius) => {
		expect(Season.shape.placeRadius.safeParse(radius).success).toBe(false)
	})

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

describe("Location", () => {
	const place = { id: "p1", lat: 55.5079, lng: 13.2353, radius: 40 }

	it.each(["none", "warmer", "map"] as const)("accepts one place with guidance %s", (guidance) => {
		expect(Location.parse({ guidance, places: [place] })).toEqual({ guidance, places: [place] })
		expect(Location.safeParse({ guidance: "none", places: [] }).success).toBe(false)
		expect(Location.safeParse({ guidance: "none", places: [place, { ...place, id: "p2" }] }).success).toBe(false)
		expect(Location.safeParse({ guidance: "distance", places: [place] }).success).toBe(false)
		expect(Quest.parse({ ...draftQuest, location: { guidance: "none", places: [place] } }).location).toEqual({
			guidance: "none",
			places: [place],
		})
	})

	it.each([2, 3])("accepts %s places only with map guidance", (count) => {
		const places = Array.from({ length: count }, (_, index) => ({ ...place, id: `p${index + 1}` }))
		expect(Location.parse({ guidance: "map", places })).toEqual({ guidance: "map", places })
		for (const guidance of ["none", "warmer", undefined]) {
			expect(Location.safeParse({ guidance, places }).success).toBe(false)
		}
	})

	it.each([0, 4])("rejects %s places even with map guidance", (count) => {
		const places = Array.from({ length: count }, (_, index) => ({ ...place, id: `p${index + 1}` }))
		expect(Location.safeParse({ guidance: "map", places }).success).toBe(false)
	})

	it("reads absent legacy guidance as none without changing stored input", () => {
		const stored = { places: [place] }
		expect(Location.parse(stored)).toEqual({ guidance: "none", places: [place] })
		expect(stored).toEqual({ places: [place] })
	})

	it.each([
		{ id: "" },
		{ lat: -90.01 },
		{ lat: 90.01 },
		{ lng: -180.01 },
		{ lng: 180.01 },
		{ lat: Number.NaN },
		{ lng: Number.POSITIVE_INFINITY },
		{ radius: 4 },
		{ radius: 501 },
		{ radius: 40.5 },
	])("rejects invalid place %j", (invalid) => {
		expect(Place.safeParse({ ...place, ...invalid }).success).toBe(false)
	})

	it.each([
		{ lat: -90, lng: -180, radius: 5 },
		{ lat: 90, lng: 180, radius: 500 },
	])("accepts place boundaries %j", (bounds) => {
		expect(Place.parse({ ...place, ...bounds })).toEqual({ ...place, ...bounds })
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
