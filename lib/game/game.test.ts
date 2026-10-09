import { beforeAll, describe, expect, it } from "vitest"
import { createSeason } from "@/lib/db/seasons"
import { createTeam, getTeam } from "@/lib/db/teams"
import type { Team } from "@/lib/domain/schemas"
import { boardChannel, seasonChannel, subscribe, teamChannel } from "@/lib/events/bus"
import { buildFixture } from "@/scripts/fixture"
import { useTestDb } from "@/test/db"
import { secretAnswer, withSecrets } from "@/test/secrets"
import { loadGame, submitAnswer } from "./game"

useTestDb()

const now = new Date("2026-10-09T18:00:00Z")
const fixture = buildFixture(now)
const season = withSecrets(fixture.season)
const ninjas = fixture.teams.find((team) => team._id === "team-ninjas") as (typeof fixture.teams)[number]
const current = "backwards-log"
const next = ninjas.questOrder[ninjas.questIndex + 1] as string

let created = 0
async function freshTeam(overrides: Partial<Team> = {}): Promise<Team> {
	created++
	return createTeam({ ...ninjas, _id: `ninjas-${created}`, name: `Ninjas ${created}`, passwordHash: "x", ...overrides })
}

function recordEvents(teamId: string) {
	const events: string[] = []
	const unsubscribe = subscribe([teamChannel(teamId), seasonChannel(season._id), boardChannel], ({ channel }) =>
		events.push(channel),
	)
	return { events, unsubscribe }
}

beforeAll(async () => {
	await createSeason(season)
	for (const team of fixture.teams) if (team._id !== ninjas._id) await createTeam({ ...team, passwordHash: "x" })
})

describe("loadGame", () => {
	it("returns waiting for a seasonless team", async () => {
		expect(await loadGame(await freshTeam({ seasonId: null }), now)).toEqual({ lifecycleState: "waiting" })
	})

	it("returns the running view without secrets", async () => {
		const game = await loadGame(await freshTeam(), now)
		expect(game).toMatchObject({ lifecycleState: "running", quest: { id: current } })
		expect(JSON.stringify(game)).not.toContain("secret-")
	})
})

describe("submitAnswer", () => {
	it("leaves the team unchanged and publishes nothing on a wrong answer", async () => {
		const team = await freshTeam()
		const { events, unsubscribe } = recordEvents(team._id)
		expect(await submitAnswer(team, current, "wrong", now)).toEqual({ ok: true, correct: false })
		unsubscribe()
		expect(await getTeam(team._id)).toEqual(team)
		expect(events).toEqual([])
	})

	it("solves, publishes the three channels once and returns the next quest without secrets", async () => {
		const team = await freshTeam()
		const { events, unsubscribe } = recordEvents(team._id)
		const result = await submitAnswer(team, current, `  ${secretAnswer(current).toUpperCase()} `, now)
		unsubscribe()
		expect(result).toMatchObject({
			ok: true,
			correct: true,
			pointsEarned: 15,
			game: { lifecycleState: "running", score: team.score + 15, quest: { id: next } },
		})
		expect(JSON.stringify(result)).not.toContain("secret-")
		expect(events.toSorted()).toEqual([boardChannel, seasonChannel(season._id), teamChannel(team._id)].toSorted())
		expect(await getTeam(team._id)).toMatchObject({ score: team.score + 15, questIndex: team.questIndex + 1 })
	})

	it("returns completed after solving the last quest", async () => {
		const team = await freshTeam({ questOrder: ninjas.questOrder.slice(0, ninjas.questIndex + 1) })
		const result = await submitAnswer(team, current, secretAnswer(current), now)
		expect(result).toMatchObject({ ok: true, correct: true, game: { lifecycleState: "completed" } })
		expect(await getTeam(team._id)).toMatchObject({ completed: true })
	})

	it("re-reads the team and retries when the hint count changed", async () => {
		const team = await freshTeam()
		const stale = {
			...team,
			progress: team.progress.map((entry) => (entry.questId === current ? { ...entry, hintsRevealed: [] } : entry)),
		}
		expect(await submitAnswer(stale, current, secretAnswer(current), now)).toMatchObject({ ok: true, pointsEarned: 15 })
	})

	it.each([
		["stale", next, secretAnswer(next), now],
		["not-running", current, secretAnswer(current), season.end as Date],
		["not-running", current, secretAnswer(current), new Date((season.start as Date).getTime() - 1)],
		["invalid", current, "x".repeat(201), now],
	] as const)("returns %s without a write or publish", async (reason, questId, answer, at) => {
		const team = await freshTeam()
		const { events, unsubscribe } = recordEvents(team._id)
		expect(await submitAnswer(team, questId, answer, at)).toEqual({ ok: false, reason })
		unsubscribe()
		expect(await getTeam(team._id)).toEqual(team)
		expect(events).toEqual([])
	})

	it("scores a concurrent correct pair once", async () => {
		const team = await freshTeam()
		const { events, unsubscribe } = recordEvents(team._id)
		const results = await Promise.all([
			submitAnswer(team, current, secretAnswer(current), now),
			submitAnswer(team, current, secretAnswer(current), now),
		])
		unsubscribe()
		expect(results.map((result) => (result.ok ? result.correct : result.reason)).toSorted()).toEqual(["stale", true])
		expect(await getTeam(team._id)).toMatchObject({ score: team.score + 15, questIndex: team.questIndex + 1 })
		expect(events).toHaveLength(3)
	})
})
