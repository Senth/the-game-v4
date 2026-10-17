import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as actions from "@/app/actions"
import { TeamPreview } from "@/components/admin/team-preview"
import { registerTeam } from "@/lib/auth/register"
import { collections } from "@/lib/db/collections"
import { createSeason, setRegistrationOpen, setSeasonField } from "@/lib/db/seasons"
import {
	createTeam,
	fillQuestOrders,
	getTeam,
	listSeasonTeams,
	listTeams,
	setTeamField,
	solveCurrentQuest,
} from "@/lib/db/teams"
import type { PlayerGame } from "@/lib/domain/player-game"
import { publicBoard } from "@/lib/domain/player-game"
import type { Season, Team } from "@/lib/domain/schemas"
import { boardChannel, seasonChannel, subscribe, teamChannel } from "@/lib/events/bus"
import { createLiveConnection } from "@/lib/events/live-connection"
import { buildFixture } from "@/scripts/fixture"
import { useTestDb } from "@/test/db"
import { secretAnswer, withSecrets } from "@/test/secrets"
import { loadBoard, loadGame, loadStandings, revealHint, submitAnswer } from "./game"

const session = vi.hoisted(() => ({ teamId: "" }))
vi.mock("@/lib/auth/guards", async () => {
	const { getTeam } = await import("@/lib/db/teams")
	return { requireTeam: async () => getTeam(session.teamId) }
})

vi.mock("@/lib/db/teams", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/db/teams")>()
	return {
		...original,
		fillQuestOrders: vi.fn(original.fillQuestOrders),
		listTeams: vi.fn(original.listTeams),
		solveCurrentQuest: vi.fn(original.solveCurrentQuest),
	}
})

useTestDb()

const now = new Date("2026-10-09T18:00:00Z")
const fixture = buildFixture(now)
const season = withSecrets(fixture.season)
const ninjas = fixture.teams.find((team) => team._id === "team-ninjas") as (typeof fixture.teams)[number]
const current = "backwards-log"
const next = ninjas.questOrder[ninjas.questIndex + 1] as string
const hint = (n: number) => `${current}-h${n}`
const standingsSeason = { ...season, _id: "standings-season" }
const standingsTeams = fixture.teams.map((team) => ({
	...team,
	_id: `standings-${team._id}`,
	seasonId: standingsSeason._id,
	passwordHash: "secret-passwordHash",
}))
const standingsTeam = standingsTeams.find((team) => team.name === ninjas.name) as Team

let created = 0
async function freshTeam(overrides: Partial<Team> = {}): Promise<Team> {
	created++
	return createTeam({ ...ninjas, _id: `ninjas-${created}`, name: `Ninjas ${created}`, passwordHash: "x", ...overrides })
}

function recordEvents(teamId: string, seasonId = season._id) {
	const events: string[] = []
	const unsubscribe = subscribe([teamChannel(teamId), seasonChannel(seasonId), boardChannel], ({ channel }) =>
		events.push(channel),
	)
	return { events, unsubscribe }
}

beforeAll(async () => {
	await createSeason(season)
	for (const team of fixture.teams) if (team._id !== ninjas._id) await createTeam({ ...team, passwordHash: "x" })
	await createSeason(standingsSeason)
	for (const team of standingsTeams) await createTeam(team)
})

describe("loadGame", () => {
	it.each([false, true])("skips a missing current quest during the season/team write gap, last=%s", async (last) => {
		const gapSeason = await createSeason({
			...season,
			_id: crypto.randomUUID(),
			arcs: season.arcs.map((arc) => ({ ...arc, quests: arc.quests.filter((quest) => quest.id !== current) })),
		})
		const team = await freshTeam({
			seasonId: gapSeason._id,
			questOrder: last ? [current] : [current, next],
			questIndex: 0,
			score: 0,
			progress: ninjas.progress.filter((entry) => entry.questId === current),
		})
		expect(await loadGame(team, now)).toMatchObject(
			last
				? { lifecycleState: "completed", score: 0 }
				: { lifecycleState: "running", quest: { id: next }, score: 0, total: 1 },
		)
		expect(await getTeam(team._id)).toEqual(team)
	})

	it("returns waiting for a seasonless team", async () => {
		expect(await loadGame(await freshTeam({ seasonId: null }), now)).toEqual({ lifecycleState: "waiting" })
	})

	it("keeps join URLs out of getGame JSON", async () => {
		session.teamId = (await freshTeam())._id
		expect(JSON.stringify(await actions.getGame())).not.toContain("/join/")
	})

	it("returns the running view without secrets", async () => {
		const game = await loadGame(await freshTeam(), now)
		expect(game).toMatchObject({ lifecycleState: "running", quest: { id: current } })
		expect(JSON.stringify(game)).not.toContain("secret-")
		expect(JSON.stringify(game)).not.toContain("/join/")
	})

	it.each(["completed", "ended"] as const)("loads shared rank and season team count when %s", async (state) => {
		const team = { ...standingsTeam, completed: state === "completed" }
		await setTeamField(team._id, "completed", team.completed)
		try {
			const game = await loadGame(team, season.end as Date)
			expect(game).toEqual({ lifecycleState: state, score: team.score, rank: 7, teamCount: 10 })
			expect(JSON.stringify(game)).not.toContain("secret-")
		} finally {
			await setTeamField(team._id, "completed", false)
		}
	})
})

describe("loadStandings", () => {
	it("returns waiting for a seasonless team or missing season", async () => {
		for (const seasonId of [null, "missing-season"]) {
			expect(await loadStandings({ ...standingsTeam, seasonId }, now)).toEqual({ lifecycleState: "waiting" })
		}
	})

	it.each(["running", "ended"] as const)("loads only the season's teams without secrets when %s", async (state) => {
		const standings = await loadStandings(standingsTeam, state === "running" ? now : (season.end as Date))
		expect(standings.lifecycleState).toBe(state)
		if (standings.lifecycleState !== "running" && standings.lifecycleState !== "ended")
			throw new Error(standings.lifecycleState)
		expect(standings.rows).toHaveLength(10)
		expect(standings.rows.map((row) => row.id).toSorted()).toEqual(standingsTeams.map((team) => team._id).toSorted())
		expect(standings.you).toMatchObject({ name: ninjas.name, score: ninjas.score, solved: 5, total: 12 })
		const currents = standings.rows
			.flatMap((row) => row.rail.flatMap((arc) => arc.segments))
			.filter((segment) => segment.state === "current")
		expect(currents).toEqual(state === "running" ? [{ questId: current, state: "current" }] : [])
		if (standings.lifecycleState === "ended") expect(standings.you).toMatchObject({ rank: 7, teamCount: 10 })
		const json = JSON.stringify(standings)
		expect(json).not.toContain("secret-")
		for (const field of ["passwordHash", "progress", "hints", "answers", "internalTitle", "adminNotes"])
			expect(json).not.toContain(field)
	})
})

describe("loadBoard", () => {
	const boardSeason = {
		...season,
		_id: "board-season",
		start: new Date(now.getTime() - 1),
		end: new Date((season.end as Date).getTime() + 1),
	}
	const upcoming = { ...season, _id: "board-upcoming", start: new Date((boardSeason.end as Date).getTime() + 60_000) }
	const team = { ...standingsTeam, _id: "board-team", seasonId: boardSeason._id }

	beforeAll(async () => {
		await createSeason(boardSeason)
		await createSeason(upcoming)
		await createTeam(team)
	})

	it.each(["running", "final"] as const)(
		"reads teams only for chosen %s season and returns publicBoard",
		async (view) => {
			const at = view === "running" ? now : (boardSeason.end as Date)
			const read = vi.mocked(listTeams).mockClear()
			const board = await loadBoard(at)
			expect(board.view).toBe(view)
			expect(board).toEqual(
				publicBoard([season, standingsSeason, boardSeason, upcoming], { [boardSeason._id]: [team] }, at),
			)
			expect(read).toHaveBeenCalledExactlyOnceWith(boardSeason._id)
			const json = JSON.stringify(board)
			for (const field of [
				"secret-",
				"passwordHash",
				"progress",
				"hints",
				"answers",
				"internalTitle",
				"adminNotes",
				"current",
			])
				expect(json).not.toContain(field)
		},
	)

	it("does not read teams when idle", async () => {
		const read = vi.mocked(listTeams).mockClear()
		expect(await loadBoard(new Date((season.start as Date).getTime() - 1))).toEqual({
			view: "idle",
			nextStart: season.start,
		})
		expect(read).not.toHaveBeenCalled()
	})
})

describe("loader snapshots", () => {
	it.each(["running", "ended", "completed"] as const)(
		"uses the team from the standings read after a teammate solve when %s",
		async (state) => {
			const team = await freshTeam(
				state === "completed" ? { questOrder: ninjas.questOrder.slice(0, ninjas.questIndex + 1) } : {},
			)
			const authenticated = (await getTeam(team._id)) as Team
			expect(
				await solveCurrentQuest(
					team._id,
					{ questIndex: team.questIndex, questId: current, orderLength: team.questOrder.length, hintCount: 1 },
					now,
					15,
				),
			).toBe(true)
			const at = state === "ended" ? (season.end as Date) : now
			const game = await loadGame(authenticated, at)
			expect(game).toMatchObject({ lifecycleState: state, score: team.score + 15 })
			if (game.lifecycleState === "running") {
				expect(game).toMatchObject({ solved: 6, total: 12, quest: { id: next } })
			} else {
				expect(game).toMatchObject({ rank: 6 })
			}
			const standings = await loadStandings(authenticated, at)
			expect(standings.lifecycleState).toBe(state)
			if (
				standings.lifecycleState !== "running" &&
				standings.lifecycleState !== "completed" &&
				standings.lifecycleState !== "ended"
			)
				throw new Error(standings.lifecycleState)
			const expected = { score: team.score + 15, solved: 6, total: team.questOrder.length }
			expect(standings.you).toMatchObject(expected)
			expect(standings.rows.find((row) => row.id === team._id)).toMatchObject({ ...expected, rank: 6 })
		},
	)
})

describe("submitAnswer", () => {
	it("refreshes the admin team preview through the season channel within 1 second of a player solve", async () => {
		const team = await freshTeam()
		const preview = async () => {
			const teams = await listSeasonTeams(season._id)
			const fresh = teams.find((candidate) => candidate._id === team._id)
			if (!fresh) throw new Error("Missing preview team")
			const props = { season, team: fresh, teams, now: now.getTime() }
			expect(JSON.stringify(props)).not.toContain("passwordHash")
			return renderToStaticMarkup(createElement(TeamPreview, props))
		}
		expect(await preview()).toContain("Start from the bottom.")
		const received = Promise.withResolvers<string>()
		const source = {
			readyState: 1,
			close: vi.fn(),
			onopen: null,
			onmessage: null as (() => void) | null,
			onerror: null,
		}
		const connection = createLiveConnection({
			url: `/api/events?channel=${seasonChannel(season._id)}`,
			fetcher: preview,
			onData: received.resolve,
			createEventSource: () => source,
		})
		connection.start()
		const unsubscribe = subscribe([seasonChannel(season._id)], () => source.onmessage?.())
		let timer: ReturnType<typeof setTimeout> | undefined
		const deadline = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error("Admin team preview did not advance within 1 second")), 1000)
		})
		try {
			const html = await Promise.race([
				submitAnswer(team, current, secretAnswer(current), now).then((result) => {
					expect(result).toMatchObject({ ok: true, correct: true })
					return received.promise
				}),
				deadline,
			])
			const quest = season.arcs.flatMap((arc) => arc.quests).find((quest) => quest.id === next)
			expect(html).toContain(quest?.displayTitle ?? "Missing next quest")
			expect(html).not.toContain("Start from the bottom.")
		} finally {
			clearTimeout(timer)
			unsubscribe()
			connection.stop()
		}
	})

	it("advances two sessions of the same team through live events within 1 second", async () => {
		const team = await freshTeam()
		const sessions = [0, 1].map(() => {
			const received = Promise.withResolvers<PlayerGame>()
			const source = {
				readyState: 1,
				close: vi.fn(),
				onopen: null as (() => void) | null,
				onmessage: null as (() => void) | null,
				onerror: null as (() => void) | null,
			}
			const connection = createLiveConnection({
				url: `/api/events?channel=${teamChannel(team._id)}`,
				fetcher: async () => loadGame((await getTeam(team._id)) as Team, now),
				onData: received.resolve,
				createEventSource: () => source,
			})
			connection.start()
			const unsubscribe = subscribe([teamChannel(team._id), seasonChannel(season._id)], () => source.onmessage?.())
			return { received, connection, unsubscribe }
		})
		let timer: ReturnType<typeof setTimeout> | undefined
		const deadline = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error("Team sessions did not advance within 1 second")), 1000)
		})
		try {
			const states = await Promise.race([
				submitAnswer(team, current, secretAnswer(current), now).then((result) => {
					expect(result).toMatchObject({ ok: true, correct: true })
					return Promise.all(sessions.map((session) => session.received.promise))
				}),
				deadline,
			])
			for (const state of states) expect(state).toMatchObject({ lifecycleState: "running", quest: { id: next } })
		} finally {
			clearTimeout(timer)
			for (const session of sessions) {
				session.unsubscribe()
				session.connection.stop()
			}
		}
	})

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

describe("lazy quest orders", () => {
	const loaders = [
		{ name: "loadGame", load: loadGame },
		{ name: "loadStandings", load: loadStandings },
		{ name: "loadBoard", load: (_team: Team, at: Date) => loadBoard(at) },
	]

	beforeEach(async () => {
		const { seasons, teams } = await collections()
		await seasons.deleteMany({})
		await teams.deleteMany({})
		vi.mocked(fillQuestOrders).mockClear()
		vi.mocked(listTeams).mockClear()
	})

	async function pendingTeam(overrides: Partial<Season> = {}) {
		const pending = await createSeason({
			...season,
			_id: crypto.randomUUID(),
			start: now,
			end: new Date(now.getTime() + 3_600_000),
			shuffleArcs: true,
			...overrides,
		})
		const team = await freshTeam({
			seasonId: pending._id,
			questOrder: [],
			progress: [],
			questIndex: 0,
			score: 0,
			completed: false,
		})
		return { pending, team }
	}

	it("fills a team registered before start on its first load at start", async () => {
		const { pending } = await pendingTeam()
		const beforeStart = new Date(now.getTime() - 1)
		await setRegistrationOpen(pending._id, true, beforeStart)
		const registered = await registerTeam("Early birds", "password", beforeStart)
		if (!registered.ok) throw new Error(registered.error)
		expect(registered.team.questOrder).toEqual([])
		expect(await loadGame(registered.team, beforeStart)).toEqual({ lifecycleState: "countdown", start: now })
		expect(vi.mocked(fillQuestOrders)).not.toHaveBeenCalled()
		const game = await loadGame(registered.team, now)
		const stored = await getTeam(registered.team._id)
		expect(stored?.questOrder).toHaveLength(12)
		expect(game).toMatchObject({ lifecycleState: "running", total: 12, quest: { id: stored?.questOrder[0] } })
		expect(JSON.stringify(game)).not.toContain("secret-")
	})

	it.each(loaders)("$name fills, re-reads and publishes once, then skips fill on refetch", async ({ name, load }) => {
		const { pending, team } = await pendingTeam()
		const { events, unsubscribe } = recordEvents(team._id, pending._id)
		const first = await load(team, now)
		const firstReads = vi.mocked(listTeams).mock.calls.length
		vi.mocked(listTeams).mockClear()
		const second = await load(team, now)
		unsubscribe()
		const stored = await getTeam(team._id)
		expect(stored?.questOrder).toHaveLength(12)
		expect(first).toMatchObject(
			name === "loadGame"
				? { total: 12, quest: { id: stored?.questOrder[0] } }
				: name === "loadStandings"
					? { you: { total: 12 }, rows: [{ total: 12 }] }
					: { rows: [{ total: 12 }] },
		)
		expect(second).toEqual(first)
		expect(firstReads).toBe(2)
		expect(vi.mocked(listTeams)).toHaveBeenCalledExactlyOnceWith(pending._id)
		expect(vi.mocked(fillQuestOrders)).toHaveBeenCalledOnce()
		expect(events).toEqual([seasonChannel(pending._id), boardChannel])
		expect(JSON.stringify(first)).not.toContain("secret-")
	})

	it("parallel teammate loads return the same persisted current quest and publish only for the winning fill", async () => {
		const { pending, team } = await pendingTeam()
		const { events, unsubscribe } = recordEvents(team._id, pending._id)
		const games = await Promise.all(Array.from({ length: 10 }, () => loadGame(team, now)))
		unsubscribe()
		const stored = await getTeam(team._id)
		expect(stored?.questOrder).toHaveLength(12)
		for (const game of games) {
			expect(game).toEqual(games[0])
			expect(game).toMatchObject({ lifecycleState: "running", quest: { id: stored?.questOrder[0] } })
		}
		const writes = await Promise.all(vi.mocked(fillQuestOrders).mock.results.map((result) => result.value))
		expect(writes.filter(Boolean)).toHaveLength(1)
		expect(events).toEqual([seasonChannel(pending._id), boardChannel])
	})

	it.each(loaders)("$name writes and publishes nothing for zero quests", async ({ load }) => {
		const { pending, team } = await pendingTeam({ arcs: [] })
		const { events, unsubscribe } = recordEvents(team._id, pending._id)
		await load(team, now)
		await load(team, now)
		unsubscribe()
		expect(await getTeam(team._id)).toEqual(team)
		expect(events).toEqual([])
		const writes = await Promise.all(vi.mocked(fillQuestOrders).mock.results.map((result) => result.value))
		expect(writes).toEqual([false, false])
	})

	it.each(loaders)("$name skips fill and extra reads for existing orders or progress", async ({ load }) => {
		const { pending, team } = await pendingTeam()
		await setTeamField(team._id, "questOrder", [current])
		await freshTeam({ seasonId: pending._id, questOrder: [], progress: ninjas.progress })
		await load(team, now)
		expect(vi.mocked(fillQuestOrders)).not.toHaveBeenCalled()
		expect(vi.mocked(listTeams)).toHaveBeenCalledExactlyOnceWith(pending._id)
	})

	it.each([null, new Date(now.getTime() + 1)])("skips fill and extra reads before start %s", async (start) => {
		const { pending, team } = await pendingTeam({ start })
		for (const load of [loadGame, loadStandings]) {
			vi.mocked(listTeams).mockClear()
			await load(team, now)
			expect(vi.mocked(listTeams)).toHaveBeenCalledExactlyOnceWith(pending._id)
		}
		expect(vi.mocked(fillQuestOrders)).not.toHaveBeenCalled()
		expect(await getTeam(team._id)).toEqual(team)
	})
})
