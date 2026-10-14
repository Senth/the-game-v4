import { describe, expect, it } from "vitest"
import { hintRevealers, worthWithAllHints } from "./hints"

describe("hintRevealers", () => {
	it("orders revealers by reveal time, preserves ties and leaves teams unchanged", () => {
		const early = new Date("2026-03-14T18:00:00Z")
		const tied = new Date("2026-03-14T18:05:00Z")
		const teams = [
			{
				name: "Tie B",
				progress: [
					{
						questId: "q1",
						hintsRevealed: [{ hintId: "h1", text: "Hint", points: 5, revealedAt: tied }],
						pointsEarned: 0,
					},
				],
			},
			{
				name: "Other quest",
				progress: [
					{
						questId: "q2",
						hintsRevealed: [{ hintId: "h1", text: "Hint", points: 5, revealedAt: early }],
						pointsEarned: 0,
					},
				],
			},
			{
				name: "First",
				progress: [
					{
						questId: "q1",
						hintsRevealed: [{ hintId: "h1", text: "Hint", points: 5, revealedAt: early }],
						pointsEarned: 0,
					},
				],
			},
			{
				name: "Tie A",
				progress: [
					{
						questId: "q1",
						hintsRevealed: [{ hintId: "h1", text: "Hint", points: 5, revealedAt: tied }],
						pointsEarned: 0,
					},
				],
			},
		]
		const original = structuredClone(teams)

		expect(hintRevealers(teams, "q1")).toEqual({ h1: ["First", "Tie B", "Tie A"] })
		expect(teams).toEqual(original)
	})
})

describe("worthWithAllHints", () => {
	it("subtracts every hint penalty from quest points", () => {
		expect(worthWithAllHints(50, [5, 10, 20])).toBe(15)
		expect(worthWithAllHints(10, [20])).toBe(-10)
	})

	it("keeps draft quest worth unknown", () => {
		expect(worthWithAllHints(null, [5, 10])).toBeNull()
	})
})
