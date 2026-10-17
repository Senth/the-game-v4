import { describe, expect, it } from "vitest"
import { questLiveStats } from "./quest-stats"

const season = { arcs: [{ quests: [{ id: "q1" }, { id: "q2" }] }] }
const revealedAt = new Date("2026-10-17T12:00:00Z")

function team(
	name: string,
	questOrder: string[],
	progress: {
		questId: string
		solvedAt?: Date
		hintsRevealed: { hintId: string; text: string; points: number; revealedAt: Date }[]
		pointsEarned: number
	}[] = [],
) {
	return { name, questOrder, progress }
}

describe("questLiveStats", () => {
	it("counts unbuilt orders and leaves quests outside built orders out of total", () => {
		const stats = questLiveStats(season, [team("Unbuilt", []), team("Q1", ["q1"]), team("Q2", ["q2"])])

		expect(stats.q1).toMatchObject({ done: 0, total: 2 })
		expect(stats.q2).toMatchObject({ done: 0, total: 2 })
	})

	it("counts a revealer without a solve", () => {
		const stats = questLiveStats(season, [
			team(
				"Ninjas",
				["q1"],
				[
					{
						questId: "q1",
						hintsRevealed: [{ hintId: "h1", text: "Hint", points: 5, revealedAt }],
						pointsEarned: 0,
					},
				],
			),
		])

		expect(stats.q1).toEqual({ done: 0, total: 1, completedBy: [], hintRevealers: { h1: ["Ninjas"] } })
	})

	it("orders completed teams by solve time", () => {
		const stats = questLiveStats(season, [
			team(
				"Later",
				["q1"],
				[{ questId: "q1", solvedAt: new Date("2026-10-17T12:02:00Z"), hintsRevealed: [], pointsEarned: 10 }],
			),
			team(
				"Earlier",
				["q1"],
				[{ questId: "q1", solvedAt: new Date("2026-10-17T12:01:00Z"), hintsRevealed: [], pointsEarned: 10 }],
			),
		])

		expect(stats.q1).toMatchObject({ done: 2, total: 2, completedBy: ["Earlier", "Later"] })
	})

	it("returns zero counts and no revealers when there are no teams", () => {
		expect(questLiveStats(season, [])).toEqual({
			q1: { done: 0, total: 0, completedBy: [], hintRevealers: {} },
			q2: { done: 0, total: 0, completedBy: [], hintRevealers: {} },
		})
	})

	it("does not mutate its inputs", () => {
		const teams = [
			team(
				"Ninjas",
				[],
				[
					{
						questId: "q1",
						solvedAt: revealedAt,
						hintsRevealed: [{ hintId: "h1", text: "Hint", points: 5, revealedAt }],
						pointsEarned: 5,
					},
				],
			),
		]
		const input = structuredClone({ season, teams })

		questLiveStats(season, teams)

		expect({ season, teams }).toEqual(input)
	})
})
