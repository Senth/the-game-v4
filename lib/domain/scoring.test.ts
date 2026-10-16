import { describe, expect, it } from "vitest"
import { hintPenalty, teamHintLoss } from "./scoring"

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
