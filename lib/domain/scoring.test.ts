import { describe, expect, it } from "vitest"
import { hintPenalty, teamHintLoss, timeBonus, timeWorth } from "./scoring"

const drop = Object.freeze({ fullMinutes: 10, dropMinutes: 20, floor: 5 })

describe("timeWorth", () => {
	it.each([
		[-60_000, 20],
		[0, 20],
		[599_999, 20],
		[600_000, 20],
		[600_001, 20],
		[679_999, 20],
		[680_000, 19],
		[1_200_000, 13],
		[1_799_999, 6],
		[1_800_000, 5],
		[2_400_000, 5],
	])("at %i ms is worth %i points", (elapsedMs, expected) => {
		expect(timeWorth(20, drop, elapsedMs)).toBe(expected)
	})

	it("keeps points without an effective drop, including null drafts", () => {
		for (const points of [null, 0, 5, 20]) {
			expect(timeWorth(points, null, 2_400_000)).toBe(points)
			expect(timeWorth(points, undefined, 2_400_000)).toBe(points)
		}
		for (const points of [null, 0, 4, 5]) {
			expect(timeWorth(points, drop, 2_400_000)).toBe(points)
		}
	})

	it("handles zero full time and floor, without changing settings", () => {
		const settings = { fullMinutes: 0, dropMinutes: 1, floor: 0 }
		const original = structuredClone(settings)
		expect(timeWorth(20, settings, -1)).toBe(20)
		expect(timeWorth(20, settings, 0)).toBe(20)
		expect(timeWorth(20, settings, 1)).toBe(20)
		expect(timeWorth(20, settings, 3_000)).toBe(19)
		expect(timeWorth(20, settings, 60_000)).toBe(0)
		expect(timeWorth(20, settings, 120_000)).toBe(0)
		expect(settings).toEqual(original)
	})
})

describe("timeBonus", () => {
	it("counts down to the first deduction at 11:20, not the end of full time", () => {
		expect(timeBonus(20, drop, 0)).toEqual({ bonus: 15, maxBonus: 15, next: { bonus: 14, inMs: 680_000 } })
		expect(timeBonus(20, drop, 600_000)).toEqual({ bonus: 15, maxBonus: 15, next: { bonus: 14, inMs: 80_000 } })
		expect(timeBonus(20, drop, 679_999)).toEqual({ bonus: 15, maxBonus: 15, next: { bonus: 14, inMs: 1 } })
	})

	it("advances the countdown at every deduction and stops at the floor", () => {
		const original = structuredClone(drop)
		for (let lost = 1; lost <= 15; lost++) {
			const elapsedMs = 600_000 + lost * 80_000
			const bonus = 15 - lost
			expect(timeBonus(20, drop, elapsedMs)).toEqual({
				bonus,
				maxBonus: 15,
				next: bonus > 0 ? { bonus: bonus - 1, inMs: 80_000 } : null,
			})
		}
		expect(timeBonus(20, drop, 2_400_000)).toEqual({ bonus: 0, maxBonus: 15, next: null })
		expect(drop).toEqual(original)
	})

	it("rounds non-integer deduction times up to the next millisecond", () => {
		const settings = { fullMinutes: 0, dropMinutes: 1, floor: 0 }
		expect(timeBonus(7, settings, 0)).toEqual({ bonus: 7, maxBonus: 7, next: { bonus: 6, inMs: 8_572 } })
		expect(timeWorth(7, settings, 8_571)).toBe(7)
		expect(timeBonus(7, settings, 8_572)).toEqual({ bonus: 6, maxBonus: 7, next: { bonus: 5, inMs: 8_571 } })
		expect(timeBonus(7, settings, 60_000)).toEqual({ bonus: 0, maxBonus: 7, next: null })
	})

	it("has no time bonus without an effective drop", () => {
		expect(timeBonus(20, null, 0)).toBeNull()
		expect(timeBonus(20, undefined, 0)).toBeNull()
		for (const points of [null, 0, 4, 5]) expect(timeBonus(points, drop, 0)).toBeNull()
	})
})

describe("hintPenalty", () => {
	it("is 0 without reveals", () => {
		expect(hintPenalty([])).toBe(0)
	})

	it("sums snapshot points even when the source hints are gone", () => {
		const revealedAt = new Date("2026-03-14T18:00:00Z")
		const snapshots = [
			{ hintId: "deleted-hint", text: "Look north", points: 5, revealedAt },
			{ hintId: "edited-hint", text: "Old wording", points: 10, revealedAt },
			{ hintId: "free-hint", text: "Free", points: 0, revealedAt },
		]
		expect(hintPenalty(snapshots)).toBe(15)
	})
})

describe("teamHintLoss", () => {
	it("is 0 without progress or reveals", () => {
		expect(teamHintLoss({ progress: [] })).toBe(0)
		expect(teamHintLoss({ progress: [{ questId: "q1", hintsRevealed: [], pointsEarned: 10 }] })).toBe(0)
	})

	it("sums solved and current quest snapshots, including deleted hints, without changing history", () => {
		const revealedAt = new Date("2026-03-14T18:00:00Z")
		const team = {
			progress: [
				{
					questId: "q1",
					solvedAt: revealedAt,
					pointsEarned: 25,
					hintsRevealed: [{ hintId: "deleted-hint", text: "Old hint", points: 5, revealedAt }],
				},
				{
					questId: "q2",
					pointsEarned: 0,
					hintsRevealed: [
						{ hintId: "edited-hint", text: "Original text", points: 10, revealedAt },
						{ hintId: "free-hint", text: "Free", points: 0, revealedAt },
					],
				},
			],
		}
		const original = structuredClone(team)
		expect(teamHintLoss(team)).toBe(15)
		expect(team).toEqual(original)
	})
})
