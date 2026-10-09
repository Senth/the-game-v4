import { describe, expect, it } from "vitest"
import { buildFixture } from "@/scripts/fixture"
import { withSecrets } from "@/test/secrets"
import { playerGame } from "./player-game"

const now = new Date("2026-10-09T18:00:00Z")
const { season, teams } = buildFixture(now)
const ninjas = teams.find((team) => team._id === "team-ninjas") as (typeof teams)[number]
const start = season.start as Date
const end = season.end as Date

const secretSeason = withSecrets(season)

const cases = {
	waiting: [{ ...secretSeason, start: null, end: null }, ninjas, now],
	countdown: [secretSeason, ninjas, new Date(start.getTime() - 1)],
	running: [secretSeason, ninjas, now],
	completed: [secretSeason, { ...ninjas, completed: true }, end],
	ended: [secretSeason, ninjas, end],
} as const

describe("playerGame", () => {
	it("returns waiting for a null, missing or unscheduled season", () => {
		expect(playerGame(null, ninjas, teams, now)).toEqual({ lifecycleState: "waiting" })
		expect(playerGame(undefined, ninjas, teams, now)).toEqual({ lifecycleState: "waiting" })
		expect(playerGame({ ...season, start: null, end: null }, ninjas, teams, now)).toEqual({
			lifecycleState: "waiting",
		})
	})

	it("returns only the start during countdown", () => {
		expect(playerGame(season, ninjas, teams, new Date(start.getTime() - 1))).toEqual({
			lifecycleState: "countdown",
			start,
		})
	})

	it("returns the current quest, pace, rail and strip while running", () => {
		const game = playerGame(season, ninjas, teams, now)
		if (game.lifecycleState !== "running") throw new Error(game.lifecycleState)
		expect(game.quest?.id).toBe("backwards-log")
		expect(game.quest?.displayTitle).toBe("The keeper's last log")
		expect(game.quest?.hints.map((hint) => hint.revealed)).toEqual([true, false, false])
		expect(game).toMatchObject({ score: ninjas.score, start, end, pace: { band: "pace-2", label: "2 behind" } })
		expect(game.rail.map((arc) => arc.arcId)).toEqual(["lighthouse", "old-town", "finale"])
		expect(game.rail.flatMap((arc) => arc.segments).filter((segment) => segment.state === "current")).toEqual([
			{ questId: "backwards-log", state: "current" },
		])
		expect(game.strip.map((entry) => (entry.kind === "team" ? entry.rank : "gap"))).toEqual([1, "gap", 6, 7])
	})

	it("returns a null quest and pace for a running team with an empty order", () => {
		const team = { ...ninjas, questOrder: [], questIndex: 0, progress: [] }
		expect(playerGame(season, team, teams, now)).toMatchObject({ lifecycleState: "running", quest: null, pace: null })
	})

	it("returns only the score when completed, including after end", () => {
		const team = { ...ninjas, completed: true }
		expect(playerGame(season, team, teams, now)).toEqual({ lifecycleState: "completed", score: ninjas.score })
		expect(playerGame(season, team, teams, new Date(end.getTime() + 1))).toEqual({
			lifecycleState: "completed",
			score: ninjas.score,
		})
	})

	it("returns only the score when ended", () => {
		expect(playerGame(season, ninjas, teams, end)).toEqual({ lifecycleState: "ended", score: ninjas.score })
	})

	it.each(Object.entries(cases))("keeps secrets out of %s JSON and leaves inputs unchanged", (state, args) => {
		const [caseSeason, team, at] = args
		const before = structuredClone({ caseSeason, team, teams })
		const game = playerGame(caseSeason, team, teams, at)
		expect(game.lifecycleState).toBe(state)
		expect(JSON.stringify(game)).not.toContain("secret-")
		expect({ caseSeason, team, teams }).toEqual(before)
	})

	it("shows revealed snapshot text while running", () => {
		expect(JSON.stringify(playerGame(secretSeason, ninjas, teams, now))).toContain("Start from the bottom.")
	})
})
