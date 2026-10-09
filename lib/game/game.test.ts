import { beforeAll, describe, expect, it, vi } from "vitest"
import * as actions from "@/app/actions"
import { createSeason, setSeasonField } from "@/lib/db/seasons"
import { createTeam, getTeam, solveCurrentQuest } from "@/lib/db/teams"
import type { Team } from "@/lib/domain/schemas"
import { boardChannel, seasonChannel, subscribe, teamChannel } from "@/lib/events/bus"
import { buildFixture } from "@/scripts/fixture"
import { useTestDb } from "@/test/db"
import { secretAnswer, withSecrets } from "@/test/secrets"
import { loadGame, revealHint, submitAnswer } from "./game"

const session = vi.hoisted(() => ({ teamId: "" }))
vi.mock("@/lib/auth/guards", async () => {
	const { getTeam } = await import("@/lib/db/teams")
	return { requireTeam: async () => getTeam(session.teamId) }
})

vi.mock("@/lib/db/teams", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/db/teams")>()
	return { ...original, solveCurrentQuest: vi.fn(original.solveCurrentQuest) }
})

useTestDb()

const now = new Date("2026-10-09T18:00:00Z")
const fixture = buildFixture(now)
const season = withSecrets(fixture.season)
const ninjas = fixture.teams.find((team) => team._id === "team-ninjas") as (typeof fixture.teams)[number]
const current = "backwards-log"
const next = ninjas.questOrder[ninjas.questIndex + 1] as string
const hint = (n: number) => `${current}-h${n}`

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

	it("gives up as stale after three retries without a publish", async () => {
		const team = await freshTeam()
		const solve = vi.mocked(solveCurrentQuest).mockClear().mockResolvedValue(false)
		const { events, unsubscribe } = recordEvents(team._id)
		const result = await submitAnswer(team, current, secretAnswer(current), now)
		unsubscribe()
		const calls = solve.mock.calls.length
		solve.mockReset()
		expect(result).toEqual({ ok: false, reason: "stale" })
		expect(calls).toBe(4)
		expect(events).toEqual([])
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

describe("revealHint", () => {
	it("stores a snapshot, publishes the three channels once and shows only the revealed text", async () => {
		const team = await freshTeam()
		expect(JSON.stringify(await loadGame(team, now))).not.toContain(`secret-hint-${hint(2)}`)
		const { events, unsubscribe } = recordEvents(team._id)
		const result = await revealHint(team, hint(2), now)
		unsubscribe()
		expect(result).toMatchObject({ ok: true, game: { quest: { id: current, worth: 5 } } })
		const json = JSON.stringify(result)
		expect(json).toContain(`secret-hint-${hint(2)}`)
		expect(json).not.toContain(`secret-hint-${hint(3)}`)
		expect(events.toSorted()).toEqual([boardChannel, seasonChannel(season._id), teamChannel(team._id)].toSorted())
		const progress = (await getTeam(team._id))?.progress.find((entry) => entry.questId === current)
		expect(progress?.hintsRevealed.at(-1)).toEqual({
			hintId: hint(2),
			text: `secret-hint-${hint(2)}`,
			points: 10,
			revealedAt: now,
		})
	})

	it("treats a repeat reveal as a no-op without a publish", async () => {
		const team = await freshTeam()
		const { events, unsubscribe } = recordEvents(team._id)
		expect(await revealHint(team, hint(1), now)).toMatchObject({ ok: true, game: { quest: { id: current } } })
		unsubscribe()
		expect(await getTeam(team._id)).toEqual(team)
		expect(events).toEqual([])
	})

	it("stores one snapshot and publishes once for a concurrent reveal pair", async () => {
		const team = await freshTeam()
		const { events, unsubscribe } = recordEvents(team._id)
		const results = await Promise.all([revealHint(team, hint(2), now), revealHint(team, hint(2), now)])
		unsubscribe()
		expect(results.map((result) => result.ok)).toEqual([true, true])
		const progress = (await getTeam(team._id))?.progress.find((entry) => entry.questId === current)
		expect(progress?.hintsRevealed.filter((snapshot) => snapshot.hintId === hint(2))).toHaveLength(1)
		expect(events).toHaveLength(3)
	})

	it.each([
		["stale", `${next}-h1`, now],
		["stale", "missing", now],
		["not-running", hint(2), season.end as Date],
	] as const)("returns %s for %s without a write or publish", async (reason, hintId, at) => {
		const team = await freshTeam()
		const { events, unsubscribe } = recordEvents(team._id)
		expect(await revealHint(team, hintId, at)).toEqual({ ok: false, reason })
		unsubscribe()
		expect(await getTeam(team._id)).toEqual(team)
		expect(events).toEqual([])
	})
})

describe("hint history through the actions", () => {
	it("scores snapshots and keeps them through edits, reorder, deletion and solve", async () => {
		const target = { arcId: "flow-arc", questId: "flow-q" }
		const flow = await createSeason({
			title: "Flow",
			lengthMinutes: 120,
			start: new Date(Date.now() - 3_600_000),
			end: new Date(Date.now() + 3_600_000),
			shuffleArcs: false,
			arcs: [
				{
					id: target.arcId,
					title: "Flow",
					shuffleQuests: false,
					quests: [
						{
							id: target.questId,
							displayTitle: "Beacon",
							internalTitle: "beacon",
							content: "",
							assetPath: null,
							answers: ["lamp"],
							points: 50,
							adminNotes: "",
							hints: [
								{ id: "f1", text: "Count the flashes", points: 5 },
								{ id: "f2", text: "Morse", points: 10 },
							],
						},
					],
				},
			],
		})
		const team = await createTeam({
			name: "Flow team",
			passwordHash: "x",
			seasonId: flow._id,
			questOrder: [target.questId],
			questIndex: 0,
			score: 0,
			completed: false,
			progress: [],
		})
		session.teamId = team._id

		expect(await actions.revealHint("f1")).toMatchObject({ ok: true })
		expect(await actions.revealHint("f2")).toMatchObject({ ok: true })
		const snapshots = (await getTeam(team._id))?.progress[0]?.hintsRevealed
		expect(snapshots?.map(({ hintId, text, points }) => ({ hintId, text, points }))).toEqual([
			{ hintId: "f1", text: "Count the flashes", points: 5 },
			{ hintId: "f2", text: "Morse", points: 10 },
		])

		await setSeasonField(flow._id, { ...target, hintId: "f1", field: "text" }, "Rewritten")
		await setSeasonField(flow._id, { ...target, hintId: "f1", field: "points" }, 20)
		await setSeasonField(flow._id, { ...target, field: "hints" }, [
			{ id: "f2", text: "Morse", points: 10 },
			{ id: "f1", text: "Rewritten", points: 20 },
		])
		await setSeasonField(flow._id, { ...target, field: "hints" }, [{ id: "f1", text: "Rewritten", points: 20 }])

		expect(await actions.submitAnswer(target.questId, "Lamp")).toMatchObject({
			ok: true,
			correct: true,
			pointsEarned: 35,
			game: { lifecycleState: "completed", score: 35 },
		})
		await setSeasonField(flow._id, { ...target, hintId: "f1", field: "text" }, "After solve")
		expect(await getTeam(team._id)).toMatchObject({
			score: 35,
			completed: true,
			progress: [{ questId: target.questId, hintsRevealed: snapshots, pointsEarned: 35 }],
		})
	})
})
