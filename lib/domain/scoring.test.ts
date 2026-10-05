import { describe, expect, it } from "vitest"
import { hintPenalty } from "./scoring"

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
