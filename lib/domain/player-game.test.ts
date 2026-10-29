import { describe, expect, it } from "vitest"
import { buildFixture } from "@/scripts/fixture"
import { withSecrets } from "@/test/secrets"
import { standingsRows } from "./game"
import { playerGame, playerStandings, publicBoard } from "./player-game"
import type { Phone } from "./schemas"

const now = new Date("2026-10-09T18:00:00Z")
const fixture = buildFixture(now)
const season = fixture.season
const teams = fixture.teams.map((team) => ({ ...team, passwordHash: "secret-passwordHash" }))
const ninjas = teams.find((team) => team._id === "team-ninjas") as (typeof teams)[number]
const start = season.start as Date
const end = season.end as Date

const secretSeason = withSecrets(season)

const phones: Phone[] = [
	["Zebra", "you", 0],
	["Bear", "other", 600_000],
	["Away", "away", 600_001],
	["Ant", "third", 1],
].map(([name, phoneId, age]) => ({
	_id: `record-${phoneId}`,
	teamId: ninjas._id,
	phoneId: String(phoneId),
	name: String(name),
	lastSeenAt: new Date(now.getTime() - Number(age)),
	createdAt: now,
}))

it("whitelists here phones, includes the ten-minute edge and orders your phone first without mutation", () => {
	const before = structuredClone(phones)
	for (const state of ["waiting", "countdown", "running"] as const) {
		const timing = state === "waiting" ? { start: null } : state === "countdown" ? { start: end } : {}
		const view = playerGame({ ...season, ...timing }, ninjas, teams, now, undefined, phones, "you")
		expect(view).toMatchObject({
			lifecycleState: state,
			teamName: ninjas.name,
			phones: [
				{ name: "Zebra", you: true },
				{ name: "Ant", you: false },
				{ name: "Bear", you: false },
			],
		})
		if (!("phones" in view)) throw new Error("Expected phones")
		for (const phone of view.phones) expect(Object.keys(phone).sort()).toEqual(["name", "you"])
	}
	const preview = playerGame(season, ninjas, teams, now, undefined, phones)
	expect(preview).toHaveProperty("phones", [
		{ name: "Ant", you: false },
		{ name: "Bear", you: false },
		{ name: "Zebra", you: false },
	])
	expect(phones).toEqual(before)
})

it("keeps phones out of completed, ended, standings, board and finisher data", () => {
	for (const view of [
		playerGame(season, { ...ninjas, completed: true }, teams, now, undefined, phones, "you"),
		playerGame(season, ninjas, teams, end, undefined, phones, "you"),
		playerStandings(season, ninjas, teams, now),
		publicBoard([season], { [season._id]: teams }, now),
	]) {
		expect(view).not.toHaveProperty("phones")
		expect(view).not.toHaveProperty("teamName")
		for (const phone of phones) expect(JSON.stringify(view)).not.toContain(phone.name)
	}
})

const cases = {
	waiting: [{ ...secretSeason, start: null, end: null }, ninjas, now],
	countdown: [secretSeason, ninjas, new Date(start.getTime() - 1)],
	running: [secretSeason, ninjas, now],
	completed: [secretSeason, { ...ninjas, completed: true }, end],
	ended: [secretSeason, ninjas, end],
} as const

it("exposes only named finisher fields across player and public views without mutating season", () => {
	const finished = {
		...secretSeason,
		finishers: [
			{ teamId: ninjas._id, place: 1, points: 50, at: now },
			{ teamId: "deleted", place: 2, points: 0, at: now },
		],
	}
	const before = structuredClone(finished)
	const expected = [
		{ teamId: ninjas._id, name: ninjas.name, place: 1, points: 50 },
		{ teamId: "deleted", name: "Deleted team", place: 2, points: 0 },
	]
	for (const at of [now, end]) {
		for (const team of [ninjas, { ...ninjas, completed: true }]) {
			for (const view of [
				playerGame(finished, team, teams, at),
				playerStandings(finished, team, teams, at),
				publicBoard([finished], { [finished._id]: teams }, at),
			]) {
				expect(view).toHaveProperty("finishers", expected)
				const json = JSON.stringify(view)
				for (const field of ["finisherBonuses", '"at":', "secret-", "passwordHash"]) expect(json).not.toContain(field)
			}
		}
	}
	expect(finished).toEqual(before)
})

it("exposes only next open bonus to running game and board notices", () => {
	const finished = {
		...secretSeason,
		finisherBonuses: [50, 0, 20],
		finishers: [{ teamId: ninjas._id, place: 1, points: 50, at: now }],
	}
	for (const view of [
		playerGame(finished, ninjas, teams, now),
		publicBoard([finished], { [finished._id]: teams }, now),
	]) {
		expect(view).toHaveProperty("nextBonus", { place: 3, points: 20 })
		expect(JSON.stringify(view)).not.toContain("finisherBonuses")
	}
	expect(playerGame({ ...finished, finisherBonuses: [50] }, ninjas, teams, now)).toHaveProperty("nextBonus", null)
})

describe("playerGame", () => {
	it("returns waiting for a null, missing or unscheduled season", () => {
		expect(playerGame(null, ninjas, teams, now)).toEqual({
			lifecycleState: "waiting",
			teamName: ninjas.name,
			phones: [],
		})
		expect(playerGame(undefined, ninjas, teams, now)).toEqual({
			lifecycleState: "waiting",
			teamName: ninjas.name,
			phones: [],
		})
		expect(playerGame({ ...season, start: null, end: null }, ninjas, teams, now)).toEqual({
			lifecycleState: "waiting",
			teamName: ninjas.name,
			phones: [],
		})
	})

	it("returns team identity and start during countdown", () => {
		expect(playerGame(season, ninjas, teams, new Date(start.getTime() - 1))).toEqual({
			lifecycleState: "countdown",
			start,
			teamName: ninjas.name,
			phones: [],
		})
	})

	it("returns the current quest, pace, rail and strip while running", () => {
		const game = playerGame(season, ninjas, teams, now)
		if (game.lifecycleState !== "running") throw new Error(game.lifecycleState)
		expect(game.quest?.id).toBe("backwards-log")
		expect(game.quest?.displayTitle).toBe("The keeper's last log")
		expect(game.quest?.hints.map((hint) => hint.revealed)).toEqual([true, false, false])
		expect(game).toMatchObject({
			solved: 5,
			total: 14,
			score: ninjas.score,
			start,
			end,
			pace: { band: "pace-3", label: "3 behind" },
		})
		expect(game.rail.map((arc) => arc.arcId)).toEqual(["lighthouse", "old-town", "finale"])
		expect(game.rail.flatMap((arc) => arc.segments).filter((segment) => segment.state === "current")).toEqual([
			{ questId: "backwards-log", state: "current" },
		])
		expect(game.strip.map((entry) => (entry.kind === "team" ? entry.rank : "gap"))).toEqual([1, "gap", 6, 7])
	})

	it("counts solved quests in the team order, excluding removed solves and unsolved progress", () => {
		const team = {
			...ninjas,
			questOrder: ninjas.questOrder.slice(1),
			progress: [
				...ninjas.progress,
				{ questId: "gone", solvedAt: now, hintsRevealed: [], pointsEarned: 10 },
				{ questId: "skipped", hintsRevealed: [], pointsEarned: 0 },
			],
		}
		expect(playerGame(season, team, teams, now)).toMatchObject({ solved: 4, total: 13 })
	})

	it("returns a null quest and pace for a running team with an empty order", () => {
		const team = { ...ninjas, questOrder: [], questIndex: 0, progress: [] }
		expect(playerGame(season, team, teams, now)).toMatchObject({
			lifecycleState: "running",
			quest: null,
			pace: null,
			solved: 0,
			total: 0,
		})
	})

	it("returns score and place when completed, including after end", () => {
		const team = { ...ninjas, completed: true }
		expect(playerGame(season, team, teams, now)).toEqual({
			lifecycleState: "completed",
			teamId: ninjas._id,
			finishers: [],
			score: ninjas.score,
			rank: 7,
			teamCount: 10,
		})
		expect(playerGame(season, team, teams, new Date(end.getTime() + 1))).toEqual({
			lifecycleState: "completed",
			teamId: ninjas._id,
			finishers: [],
			score: ninjas.score,
			rank: 7,
			teamCount: 10,
		})
	})

	it("returns score and place when ended", () => {
		expect(playerGame(season, ninjas, teams, end)).toEqual({
			lifecycleState: "ended",
			teamId: ninjas._id,
			finishers: [],
			score: ninjas.score,
			rank: 7,
			teamCount: 10,
		})
	})

	it.each(Object.entries(cases))("keeps secrets out of %s JSON and leaves inputs unchanged", (state, args) => {
		const [caseSeason, team, at] = args
		const before = structuredClone({ caseSeason, team, teams })
		const game = playerGame(caseSeason, team, teams, at)
		expect(game.lifecycleState).toBe(state)
		expect(JSON.stringify(game)).not.toContain("secret-")
		expect(JSON.stringify(game)).not.toContain("passwordHash")
		expect({ caseSeason, team, teams }).toEqual(before)
	})

	it("shows revealed snapshot text while running", () => {
		expect(JSON.stringify(playerGame(secretSeason, ninjas, teams, now))).toContain("Start from the bottom.")
	})

	it.each(["completed", "ended"] as const)("uses shared rank and counts every team when %s", (state) => {
		const team = { ...ninjas, completed: state === "completed" }
		const tied = teams.map((other) => (other._id === "team-lagom" ? { ...other, score: team.score } : other))
		expect(playerGame(season, team, tied, end)).toMatchObject({ lifecycleState: state, rank: 6, teamCount: 10 })
	})
})

describe("publicBoard", () => {
	const final = {
		...secretSeason,
		_id: "final",
		title: "Previous game",
		start: new Date(start.getTime() - 1),
		end: now,
	}
	const upcoming = { ...secretSeason, _id: "upcoming", start: new Date(end.getTime() + 1) }
	const teamsBySeason = { [season._id]: teams, [final._id]: [ninjas] }

	it("shows running instead of final, selecting latest running start and only its teams", () => {
		const olderRunning = { ...secretSeason, _id: "older", start: final.start }
		expect(publicBoard([final, secretSeason, olderRunning], teamsBySeason, now)).toEqual({
			view: "running",
			title: season.title,
			start,
			end,
			rows: standingsRows(season, teams, "", false),
			finishers: [],
			nextBonus: { place: 1, points: 50 },
			nextStart: null,
		})
		expect(publicBoard([{ ...secretSeason, end: null }], teamsBySeason, now)).toMatchObject({
			view: "running",
			end: null,
		})
	})

	it("preserves earliest future start while a season runs without an end", () => {
		const overlap = { ...upcoming, start: new Date(now.getTime() + 1000), end: null }
		const seasons = [{ ...secretSeason, end: null }, upcoming, overlap]
		expect(publicBoard(seasons, teamsBySeason, now)).toMatchObject({
			view: "running",
			title: secretSeason.title,
			end: null,
			nextStart: overlap.start,
		})
		expect(publicBoard(seasons, teamsBySeason, overlap.start)).toMatchObject({
			view: "running",
			title: overlap.title,
			start: overlap.start,
			nextStart: upcoming.start,
		})
	})

	it("keeps latest final during countdown, with earliest future start or null", () => {
		const olderFinal = { ...final, _id: "older-final", end: new Date(now.getTime() - 1) }
		const later = { ...upcoming, _id: "later", start: new Date(upcoming.start.getTime() + 1) }
		expect(publicBoard([olderFinal, later, final, upcoming], teamsBySeason, now)).toEqual({
			view: "final",
			title: final.title,
			rows: standingsRows(final, [ninjas], "", false),
			finishers: [],
			nextStart: upcoming.start,
		})
		expect(publicBoard([final], teamsBySeason, now)).toMatchObject({ view: "final", nextStart: null })
	})

	it("returns idle when nothing started and empty rows for a season without teams", () => {
		expect(publicBoard([upcoming, { ...secretSeason, start: null, end: null }], teamsBySeason, now)).toEqual({
			view: "idle",
			nextStart: upcoming.start,
		})
		expect(publicBoard([], teamsBySeason, now)).toEqual({ view: "idle", nextStart: null })
		expect(publicBoard([secretSeason], {}, now)).toMatchObject({ view: "running", rows: [] })
	})

	it.each(["running", "final", "idle"] as const)(
		"keeps %s JSON public, without team tint or current segments, and inputs unchanged",
		(view) => {
			const seasons = view === "running" ? [secretSeason] : view === "final" ? [final, upcoming] : [upcoming]
			const before = structuredClone({ seasons, teamsBySeason, now })
			const board = publicBoard(seasons, teamsBySeason, now)
			expect(board.view).toBe(view)
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
			for (const team of teams)
				for (const entry of team.progress) for (const hint of entry.hintsRevealed) expect(json).not.toContain(hint.text)
			if (board.view !== "idle") {
				expect(board.rows.every((row) => row.you === false)).toBe(true)
				expect(board.rows.length).toBeGreaterThan(0)
			}
			expect({ seasons, teamsBySeason, now }).toEqual(before)
		},
	)
})

describe("playerStandings", () => {
	it("returns only waiting for a null, missing or unscheduled season", () => {
		for (const waiting of [null, undefined, { ...season, start: null, end: null }]) {
			expect(playerStandings(waiting, ninjas, teams, now)).toEqual({ lifecycleState: "waiting" })
		}
	})

	it("returns only the state during countdown", () => {
		expect(playerStandings(season, ninjas, teams, new Date(start.getTime() - 1))).toEqual({
			lifecycleState: "countdown",
		})
	})

	it("returns counts, timing and all rows with only your current quest while running", () => {
		const standings = playerStandings(season, ninjas, teams, now)
		if (standings.lifecycleState !== "running") throw new Error(standings.lifecycleState)
		expect(standings.you).toEqual({ name: ninjas.name, score: ninjas.score, solved: 5, total: 14 })
		expect(standings.start).toEqual(start)
		expect(standings.end).toEqual(end)
		expect(standings.rows).toHaveLength(10)
		expect(standings.rows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
		for (const row of standings.rows) {
			const current = row.rail.flatMap((arc) => arc.segments).filter((segment) => segment.state === "current")
			expect(current).toEqual(row.you ? [{ questId: "backwards-log", state: "current" }] : [])
		}
	})

	it.each(["completed", "ended"] as const)(
		"returns final place and rows without any current quest when %s",
		(state) => {
			const team = { ...ninjas, completed: state === "completed" }
			const standings = playerStandings(season, team, teams, end)
			expect(standings).toMatchObject({
				lifecycleState: state,
				you: { name: ninjas.name, score: ninjas.score, solved: 5, total: 14, rank: 7, teamCount: 10 },
			})
			if (standings.lifecycleState !== "completed" && standings.lifecycleState !== "ended")
				throw new Error(standings.lifecycleState)
			expect(standings.rows).toHaveLength(10)
			expect(JSON.stringify(standings)).not.toContain("current")
			expect(standings).not.toHaveProperty("start")
			expect(standings).not.toHaveProperty("end")
		},
	)

	it("keeps rows live for a completed team while the season runs", () => {
		const team = { ...ninjas, completed: true }
		const updated = teams.map((other) => (other._id === "team-losenord123" ? { ...other, score: 200 } : other))
		const standings = playerStandings(season, team, updated, now)
		if (standings.lifecycleState !== "completed") throw new Error(standings.lifecycleState)
		expect(standings.rows[0]).toMatchObject({ id: "team-losenord123", score: 200, rank: 1 })
		expect(standings.you).toMatchObject({ rank: 8, teamCount: 10 })
		expect(JSON.stringify(standings)).not.toContain("current")
	})

	it("uses shared rank, counts every team and preserves each team's own quest counts", () => {
		const tied = teams.map((other) =>
			other._id === "team-lagom" ? { ...other, score: ninjas.score, questOrder: other.questOrder.slice(0, 6) } : other,
		)
		const standings = playerStandings(season, ninjas, tied, end)
		if (standings.lifecycleState !== "ended") throw new Error(standings.lifecycleState)
		expect(standings.you).toMatchObject({ rank: 6, teamCount: 10, solved: 5, total: 14 })
		expect(standings.rows.find((row) => row.id === "team-lagom")).toMatchObject({ rank: 6, solved: 6, total: 6 })
	})

	it("keeps null end and empty order counts while running", () => {
		expect(
			playerStandings({ ...season, end: null }, { ...ninjas, questOrder: [], progress: [] }, teams, now),
		).toMatchObject({
			lifecycleState: "running",
			end: null,
			you: { solved: 0, total: 0 },
		})
	})

	it.each(Object.entries(cases))(
		"keeps secrets and all hint text out of %s JSON without mutating inputs",
		(state, args) => {
			const [caseSeason, team, at] = args
			const before = structuredClone({ caseSeason, team, teams })
			const standings = playerStandings(caseSeason, team, teams, at)
			const json = JSON.stringify(standings)
			expect(standings.lifecycleState).toBe(state)
			expect(json).not.toContain("secret-")
			for (const field of [
				"passwordHash",
				"progress",
				"hintsRevealed",
				"internalTitle",
				"adminNotes",
				"answers",
				"hints",
			]) {
				expect(json).not.toContain(field)
			}
			for (const other of teams)
				for (const entry of other.progress)
					for (const hint of entry.hintsRevealed) {
						expect(json).not.toContain(hint.text)
					}
			expect({ caseSeason, team, teams }).toEqual(before)
		},
	)
})
