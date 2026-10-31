import { describe, expect, it } from "vitest"
import { arrivalTime, bonusForPlace, nextOpenBonus, sortByArrival } from "./finishers"
import { Team } from "./schemas"

const start = new Date("2026-10-20T18:00:00Z")
const earlier = new Date("2026-10-20T18:05:00Z")
const later = new Date("2026-10-20T18:10:00Z")
const team = Team.parse({
	_id: "team",
	name: "Team",
	passwordHash: "hash",
	seasonId: "season",
	questOrder: ["first", "last"],
	questIndex: 1,
	score: 0,
	completed: false,
	progress: [
		{ questId: "last", solvedAt: earlier, hintsRevealed: [], pointsEarned: 0 },
		{ questId: "first", solvedAt: later, hintsRevealed: [], pointsEarned: 0 },
		{ questId: "removed", solvedAt: later, hintsRevealed: [], pointsEarned: 0 },
	],
})

describe("finishers", () => {
	it("uses reachedAt, then the last solve in quest order, then season start", () => {
		expect(arrivalTime({ ...team, reachedAt: later }, { start })).toEqual(later)
		expect(arrivalTime(team, { start })).toEqual(earlier)
		expect(arrivalTime({ ...team, progress: [] }, { start })).toEqual(start)
	})
	it("ignores unsolved entries and removed quests when falling back without reachedAt", () => {
		const legacy = {
			...team,
			progress: [
				{ questId: "first", solvedAt: earlier, hintsRevealed: [], pointsEarned: 10 },
				{ questId: "last", hintsRevealed: [], pointsEarned: 0 },
				{ questId: "removed", solvedAt: later, hintsRevealed: [], pointsEarned: 10 },
			],
		}
		const original = structuredClone(legacy)
		expect(arrivalTime(legacy, { start })).toEqual(earlier)
		expect(arrivalTime({ ...legacy, progress: legacy.progress.slice(1) }, { start })).toEqual(start)
		expect(arrivalTime({ ...legacy, progress: [] }, { start: null })).toEqual(new Date(0))
		expect(legacy).toEqual(original)
	})
	it("sorts arrivals without mutating teams", () => {
		const teams = [
			{ ...team, _id: "later", reachedAt: later },
			{ ...team, _id: "earlier", reachedAt: earlier },
		]
		const before = structuredClone(teams)
		expect(sortByArrival(teams, { start }).map(({ _id }) => _id)).toEqual(["earlier", "later"])
		expect(teams).toEqual(before)
	})
	it("uses one-based places and awards zero without a row", () => {
		expect(bonusForPlace([50, 20], 1)).toBe(50)
		expect(bonusForPlace([50, 20], 2)).toBe(20)
		expect(bonusForPlace([50, 20], 3)).toBe(0)
		expect(bonusForPlace([], 1)).toBe(0)
	})
	it("finds the next positive unclaimed bonus and handles legacy seasons", () => {
		expect(nextOpenBonus({})).toBeNull()
		expect(
			nextOpenBonus({ finisherBonuses: [50, 0, 20], finishers: [{ teamId: "team", place: 1, points: 50, at: start }] }),
		).toEqual({ place: 3, points: 20 })
		expect(nextOpenBonus({ finisherBonuses: [0] })).toBeNull()
	})
})
