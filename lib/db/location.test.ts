import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }))

import * as actions from "@/app/actions"
import { patchSeasonList, saveSeasonField } from "@/app/admin/autosave-actions"
import { copyQuest } from "@/app/admin/copy-actions"
import { requireAdmin, requireTeam } from "@/lib/auth/guards"
import type { Location, Team } from "@/lib/domain/schemas"
import { newQuest } from "@/lib/domain/season-tree"
import {
	boardChannel,
	livePositionsChannel,
	positionsChannel,
	seasonChannel,
	subscribe,
	teamChannel,
} from "@/lib/events/bus"
import { getSolvedLocation, loadGame, reportPosition, submitAnswer } from "@/lib/game/game"
import { clearTeamFixes, latestFixes, recordGuidanceFix } from "@/lib/game/location-fixes"
import { clearPositions } from "@/lib/game/positions"
import { useTestDb } from "@/test/db"
import { getDb } from "./client"
import * as database from "./collections"
import { collections } from "./collections"
import { createSeason, getSeason, setSeasonField } from "./seasons"
import * as structure from "./structural-writes"
import * as teams from "./teams"

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn(), requireTeam: vi.fn() }))

useTestDb()
const now = new Date()
const place = { id: "place", lat: 55.5079, lng: 13.2353, radius: 40 }
const location: Location = { guidance: "none", places: [place] }
const target = { arcId: "arc", questId: "quest", field: "location" } as const
const quest = { ...newQuest(50), id: target.questId, location, content: "Find this place", answers: ["backup"] }
const fix = { lat: 55.5079, lng: 13.2353, accuracy: 10, at: now.getTime() }
let team: Team

beforeEach(async () => {
	vi.restoreAllMocks()
	vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
	vi.setSystemTime(now)
	vi.mocked(requireAdmin).mockResolvedValue({ _id: "admin", name: "Admin", passwordHash: "x" })
	const db = await collections()
	await db.teams.deleteMany({})
	await db.seasons.deleteMany({})
	await createSeason({
		_id: "season",
		title: "Location",
		lengthMinutes: 60,
		start: new Date(now.getTime() - 1000),
		end: new Date(now.getTime() + 3_600_000),
		shuffleArcs: false,
		finisherBonuses: [20],
		arcs: [{ id: target.arcId, title: "Arc", shuffleQuests: false, quests: [quest] }],
	})
	team = await teams.createTeam({
		name: "Players",
		passwordHash: "x",
		seasonId: "season",
		questOrder: [quest.id],
		questIndex: 0,
		score: 0,
		completed: false,
		progress: [],
	})
	vi.mocked(requireTeam).mockImplementation(async () => (await teams.getTeam(team._id)) as Team)
})

afterEach(async () => {
	clearTeamFixes(team._id)
	clearPositions(team._id)
	await vi.advanceTimersByTimeAsync(2000)
	vi.clearAllTimers()
	vi.useRealTimers()
})

function mapLocation(count: number): Location {
	return {
		guidance: "map",
		places: Array.from({ length: count }, (_, index) => ({
			...place,
			id: `place-${index}`,
			lat: place.lat + index * 0.002,
		})),
	}
}

describe("location reports", () => {
	it("publishes accepted inside and outside fixes through the season throttle without persisting positions", async () => {
		await setSeasonField("season", target, mapLocation(2))
		const db = await getDb()
		const names = (await db.listCollections().toArray()).map(({ name }) => name).sort()
		const before = await Promise.all(names.map((name) => db.collection(name).find({}).toArray()))
		const ordinary = [teamChannel(team._id), seasonChannel("season"), boardChannel]
		const channel = livePositionsChannel("season")
		const events: string[] = []
		const unsubscribe = subscribe([...ordinary, channel], ({ channel }) => events.push(channel))
		try {
			expect(await reportPosition(team, "one", quest.id, { ...fix, lat: 56 }, now)).toEqual({ status: "outside" })
			expect(events).toEqual([channel])
			await vi.advanceTimersByTimeAsync(100)
			expect(await reportPosition(team, "one", quest.id, { ...fix, at: fix.at + 100 }, new Date(fix.at + 100))).toEqual(
				{ status: "outside" },
			)
			expect(events).toEqual([channel])
			await vi.advanceTimersByTimeAsync(899)
			expect(events).toEqual([channel])
			await vi.advanceTimersByTimeAsync(1)
			expect(events).toEqual([channel, channel])
			await vi.advanceTimersByTimeAsync(1000)
			expect(events).toEqual([channel, channel])
			expect(await Promise.all(names.map((name) => db.collection(name).find({}).toArray()))).toEqual(before)
			expect((await db.listCollections().toArray()).map(({ name }) => name).sort()).toEqual(names)
		} finally {
			unsubscribe()
		}
	})

	it("retains solve channels and sends a trailing live update after fixes are cleared", async () => {
		const channels = [teamChannel(team._id), seasonChannel("season"), boardChannel]
		const channel = livePositionsChannel("season")
		const events: string[] = []
		const unsubscribe = subscribe([...channels, channel], ({ channel }) => events.push(channel))
		try {
			expect(await reportPosition(team, "one", quest.id, fix, now)).toEqual({ status: "solved", pointsEarned: 50 })
			expect(events).toEqual([channel, ...channels])
			await vi.advanceTimersByTimeAsync(1000)
			expect(events).toEqual([channel, ...channels, channel])
			expect(latestFixes(team._id, Date.now()).size).toBe(0)
		} finally {
			unsubscribe()
		}
	})

	it("rejects an in-flight old-quest report after a backup solve clears fixes", async () => {
		await setSeasonField("season", target, mapLocation(2))
		await reportPosition(team, "one", quest.id, fix, now)
		const started = Promise.withResolvers<void>()
		const resume = Promise.withResolvers<void>()
		const original = teams.getTeam
		vi.spyOn(teams, "getTeam").mockImplementationOnce(async (...args) => {
			const current = await original(...args)
			started.resolve()
			await resume.promise
			return current
		})
		const pending = reportPosition(team, "late", quest.id, fix, now)
		await started.promise
		try {
			expect(await submitAnswer(team, quest.id, "backup", now)).toMatchObject({ correct: true })
		} finally {
			resume.resolve()
		}
		expect(await pending).toEqual({ status: "stop" })
		expect(latestFixes(team._id, now.getTime()).size).toBe(0)
	})

	it.each([2, 3])(
		"solves %s places once across concurrent completing phones with penalties and one finish",
		async (count) => {
			const location = mapLocation(count)
			await setSeasonField("season", target, location)
			await teams.revealHint(
				team._id,
				{ questId: quest.id, questIndex: 0 },
				{
					hintId: "deleted",
					text: "Saved hint",
					points: 7,
					revealedAt: now,
				},
			)
			const before = await teams.getTeam(team._id)
			const channels = [teamChannel(team._id), seasonChannel("season"), boardChannel]
			const events: string[] = []
			const positions: unknown[] = []
			const unsubscribe = subscribe([...channels, positionsChannel(team._id)], ({ channel, data }) => {
				if (channel === positionsChannel(team._id)) positions.push(data)
				else events.push(channel)
			})
			try {
				expect(await reportPosition(team, "phone-0", quest.id, fix, now)).toEqual({ status: "outside" })
				expect(await teams.getTeam(team._id)).toEqual(before)
				expect(events).toEqual([])
				const results = await Promise.all(
					Array.from({ length: 8 }, (_, index) => {
						const phone = (index % (count - 1)) + 1
						return reportPosition(team, `phone-${phone}`, quest.id, { ...fix, ...location.places[phone] }, now)
					}),
				)
				expect(results.filter(({ status }) => status === "solved")).toEqual([{ status: "solved", pointsEarned: 43 }])
				expect(await teams.getTeam(team._id)).toMatchObject({ score: 63, questIndex: 1, completed: true })
				expect((await getSeason("season"))?.finishers).toEqual([{ teamId: team._id, place: 1, points: 20, at: now }])
				expect(events).toEqual(channels)
				await vi.advanceTimersByTimeAsync(5000)
				expect(positions.at(-1)).toEqual({ places: [], phones: [] })
				expect(latestFixes(team._id, now.getTime()).size).toBe(0)
				expect(recordGuidanceFix(team._id, "phone-0", quest.id, fix, now.getTime())).toEqual([])
			} finally {
				unsubscribe()
			}
		},
	)

	it("never solves incomplete, shared-phone or stale multi-place coverage", async () => {
		const location = mapLocation(2)
		await setSeasonField("season", target, location)
		expect(await reportPosition(team, "one", quest.id, fix, now)).toEqual({ status: "outside" })
		const second = { ...fix, ...location.places[1], at: fix.at + 1 }
		expect(await reportPosition(team, "one", quest.id, second, new Date(fix.at + 1))).toEqual({ status: "outside" })
		expect(await reportPosition(team, "two", quest.id, { ...fix, lat: 56 }, now)).toEqual({ status: "outside" })
		const later = new Date(fix.at + 30_002)
		expect(await reportPosition(team, "two", quest.id, { ...fix, at: later.getTime() }, later)).toEqual({
			status: "outside",
		})
		expect(await teams.getTeam(team._id)).toEqual(team)
		expect((await getSeason("season"))?.finishers).toEqual([])
	})

	it.each([2, 3])("retries hint races with %s-place coverage and preserves the latest penalty", async (count) => {
		const location = mapLocation(count)
		await setSeasonField("season", target, location)
		for (let index = 0; index < count - 1; index++) {
			await reportPosition(team, `phone-${index}`, quest.id, { ...fix, ...location.places[index] }, now)
		}
		const original = teams.solveCurrentQuest
		vi.spyOn(teams, "solveCurrentQuest").mockImplementationOnce(async (...args) => {
			await teams.revealHint(
				team._id,
				{ questId: quest.id, questIndex: 0 },
				{
					hintId: "new",
					text: "Hint",
					points: 8,
					revealedAt: now,
				},
			)
			return original(...args)
		})
		expect(await reportPosition(team, "last", quest.id, { ...fix, ...location.places[count - 1] }, now)).toEqual({
			status: "solved",
			pointsEarned: 42,
		})
		expect(await teams.getTeam(team._id)).toMatchObject({ score: 62 })
		expect((await getSeason("season"))?.finishers).toHaveLength(1)
	})

	it.each(["move", "remove"])(
		"rechecks full multi-place coverage when a place %s wins the solve race",
		async (edit) => {
			const location = mapLocation(2)
			await setSeasonField("season", target, location)
			await reportPosition(team, "one", quest.id, fix, now)
			const original = teams.solveCurrentQuest
			vi.spyOn(teams, "solveCurrentQuest").mockImplementationOnce(async (...args) => {
				await setSeasonField(
					"season",
					target,
					edit === "remove"
						? null
						: {
								...location,
								places: location.places.map((place, index) => (index ? { ...place, lat: 56 } : place)),
							},
				)
				return original(...args)
			})
			expect(await reportPosition(team, "two", quest.id, { ...fix, ...location.places[1] }, now)).toEqual({
				status: edit === "remove" ? "stop" : "outside",
			})
			expect(await teams.getTeam(team._id)).toEqual(team)
			expect((await getSeason("season"))?.finishers).toEqual([])
		},
	)

	it.each([1, 2, 3])(
		"backup code solves %s places without coverage, clears fixes and history, and pushes empty positions",
		async (count) => {
			await setSeasonField("season", target, mapLocation(count))
			await reportPosition(team, "one", quest.id, { ...fix, lat: 56 }, now)
			const positions: unknown[] = []
			const unsubscribe = subscribe([positionsChannel(team._id)], ({ data }) => positions.push(data))
			try {
				expect(await submitAnswer(team, quest.id, "backup", now)).toMatchObject({ correct: true, pointsEarned: 50 })
				expect(latestFixes(team._id, now.getTime()).size).toBe(0)
				expect(recordGuidanceFix(team._id, "one", quest.id, fix, now.getTime())).toEqual([])
				await vi.advanceTimersByTimeAsync(5000)
				expect(positions).toEqual([{ places: [], phones: [] }])
				expect(await teams.getTeam(team._id)).toMatchObject({ score: 70, completed: true })
			} finally {
				unsubscribe()
			}
		},
	)

	it.each(["none", "warmer", "map"] as const)(
		"solves once across phones and retries with %s guidance, stored hint penalties, one bonus and all live channels",
		async (guidance) => {
			await setSeasonField("season", target, { ...location, guidance })
			await setSeasonField("season", { ...target, field: "drop" }, { fullMinutes: 5, dropMinutes: 10, floor: 10 })
			await teams.setTeamField(team._id, "reachedAt", new Date(now.getTime() - 600_000))
			await teams.revealHint(
				team._id,
				{ questId: quest.id, questIndex: 0 },
				{
					hintId: "deleted",
					text: "Saved hint",
					points: 7,
					revealedAt: now,
				},
			)
			expect(await getSolvedLocation(team, quest.id)).toBeNull()
			const events: string[] = []
			const channels = [teamChannel(team._id), seasonChannel("season"), boardChannel]
			const unsubscribe = subscribe(channels, ({ channel }) => events.push(channel))
			try {
				const results = await Promise.all(
					Array.from({ length: 8 }, (_, i) => reportPosition(team, `phone-${i % 2}`, quest.id, fix, now)),
				)
				expect(results.filter(({ status }) => status === "solved")).toEqual([{ status: "solved", pointsEarned: 23 }])
				expect(results.filter(({ status }) => status === "stop")).toHaveLength(7)
				expect(await reportPosition(team, "phone-0", quest.id, fix, now)).toEqual({ status: "stop" })
				expect(await teams.getTeam(team._id)).toMatchObject({
					score: 43,
					questIndex: 1,
					completed: true,
					progress: [{ questId: quest.id, solvedAt: now, pointsEarned: 23 }],
				})
				expect((await getSeason("season"))?.finishers).toEqual([{ teamId: team._id, place: 1, points: 20, at: now }])
				expect(events).toEqual(channels)
				expect(latestFixes(team._id, now.getTime()).size).toBe(0)
				expect(recordGuidanceFix(team._id, "phone-0", quest.id, fix, now.getTime())).toEqual([])
				expect(await actions.getSolvedLocation(quest.id)).toEqual({ pointsEarned: 23 })
				await setSeasonField("season", { ...target, field: "points" }, 100)
				expect(await getSolvedLocation(team, quest.id)).toEqual({ pointsEarned: 23 })
				const stored = await (await collections()).teams.findOne({ _id: team._id })
				for (const key of ["lat", "lng", "accuracy", "phone", "location"])
					expect(JSON.stringify(stored)).not.toContain(`"${key}"`)
				expect((await (await getDb()).listCollections().toArray()).map(({ name }) => name).sort()).toEqual([
					"admins",
					"phones",
					"seasons",
					"teams",
				])
			} finally {
				unsubscribe()
			}
		},
	)

	it("returns only phone-local guidance without writes, game-change events or guidance in game data", async () => {
		await setSeasonField("season", target, { ...location, guidance: "warmer" })
		const before = await teams.getTeam(team._id)
		const events: string[] = []
		const unsubscribe = subscribe([teamChannel(team._id), seasonChannel("season"), boardChannel], ({ channel }) =>
			events.push(channel),
		)
		try {
			const outside = { ...fix, lat: place.lat + 0.01 }
			expect(await reportPosition(team, "one", quest.id, outside, now)).toEqual({
				status: "outside",
				guidance: { band: "far", bearing: expect.any(Number) },
			})
			expect(await reportPosition(team, "two", quest.id, { ...outside, lat: place.lat + 0.02 }, now)).toEqual({
				status: "outside",
				guidance: { band: "far", bearing: expect.any(Number) },
			})
			expect(await reportPosition(team, "one", quest.id, { ...outside, lat: place.lat + 0.008 }, now)).toEqual({
				status: "outside",
				guidance: { band: "far", bearing: expect.any(Number), trend: "warmer" },
			})
			expect(await reportPosition(team, "one", quest.id, { ...outside, lat: place.lat + 0.009 }, now)).toEqual({
				status: "outside",
				guidance: { band: "far", bearing: expect.any(Number) },
			})
			expect(await reportPosition(team, "one", quest.id, { ...outside, lat: place.lat + 0.0095 }, now)).toEqual({
				status: "outside",
				guidance: { band: "far", bearing: expect.any(Number), trend: "colder" },
			})
			expect(await reportPosition(team, "two", quest.id, { ...outside, lat: place.lat + 0.02 }, now)).toEqual({
				status: "outside",
				guidance: { band: "far", bearing: expect.any(Number) },
			})
			expect(await teams.getTeam(team._id)).toEqual(before)
			expect(events).toEqual([])
			const game = await loadGame(team, now)
			if (game.lifecycleState !== "running") throw new Error("Expected running location quest")
			expect(game.quest?.location).toEqual({ guidance: "warmer" })
			expect(JSON.stringify(game)).not.toMatch(/"(?:bearing|trend|distance|lat|lng|radius|places)"/)
			expect(game.quest).not.toHaveProperty("band")
		} finally {
			unsubscribe()
		}
	})

	it("resets guidance when the phone reports on the next quest", async () => {
		const warmer = { ...location, guidance: "warmer" } as const
		await setSeasonField("season", target, warmer)
		await (await collections()).seasons.updateOne(
			{ _id: "season" },
			{ $push: { "arcs.0.quests": { ...quest, id: "next", location: warmer } } },
		)
		await teams.setTeamField(team._id, "questOrder", [quest.id, "next"])
		await reportPosition(team, "phone", quest.id, { ...fix, lat: place.lat + 0.01 }, now)
		expect(await reportPosition(team, "phone", quest.id, fix, now)).toEqual({ status: "solved", pointsEarned: 50 })
		expect(await reportPosition(team, "phone", "next", { ...fix, lat: place.lat + 0.008 }, now)).toEqual({
			status: "outside",
			guidance: { band: "far", bearing: expect.any(Number) },
		})
	})

	it.each([
		[60_000, "warmer"],
		[60_001, undefined],
	] as const)("expires guidance history after 60 seconds, at %s ms", async (elapsed, trend) => {
		await setSeasonField("season", target, { ...location, guidance: "warmer" })
		await reportPosition(team, "phone", quest.id, { ...fix, lat: place.lat + 0.01 }, now)
		const later = new Date(now.getTime() + elapsed)
		expect(latestFixes(team._id, later.getTime()).size).toBe(0)
		expect(
			await reportPosition(team, "phone", quest.id, { ...fix, lat: place.lat + 0.008, at: later.getTime() }, later),
		).toEqual({
			status: "outside",
			guidance: { band: "far", bearing: expect.any(Number), ...(trend ? { trend } : {}) },
		})
	})

	it("never adds rough or stale fixes to guidance history", async () => {
		await setSeasonField("season", target, { ...location, guidance: "warmer" })
		const outside = { ...fix, lat: place.lat + 0.01 }
		await reportPosition(team, "phone", quest.id, outside, now)
		for (const rejected of [
			{ ...outside, lat: place.lat + 0.02, accuracy: 51 },
			{ ...outside, lat: place.lat + 0.02, at: fix.at - 30_001 },
			{ ...outside, lat: place.lat + 0.02, at: fix.at + 30_001 },
		]) {
			expect(await reportPosition(team, "phone", quest.id, rejected, now)).toEqual({
				status: rejected.accuracy > 50 ? "rough" : "stale",
			})
		}
		expect(await reportPosition(team, "phone", quest.id, outside, now)).toEqual({
			status: "outside",
			guidance: { band: "far", bearing: expect.any(Number) },
		})
	})

	it.each([
		["rough", { ...fix, accuracy: 50.01 }],
		["stale", { ...fix, at: fix.at - 30_001 }],
		["stale", { ...fix, at: fix.at + 30_001 }],
		["outside", { ...fix, lat: 56 }],
	] as const)("%s fixes never write or publish game-change channels", async (status, report) => {
		const before = await teams.getTeam(team._id)
		const events: string[] = []
		const unsubscribe = subscribe(
			[teamChannel(team._id), seasonChannel("season"), boardChannel, livePositionsChannel("season")],
			({ channel }) => events.push(channel),
		)
		try {
			expect(await reportPosition(team, "phone", quest.id, report, now)).toEqual({ status })
			expect(await teams.getTeam(team._id)).toEqual(before)
			expect(events).toEqual(status === "outside" ? [livePositionsChannel("season")] : [])
			expect(latestFixes(team._id, now.getTime()).get("phone")).toEqual(status === "outside" ? report : undefined)
		} finally {
			unsubscribe()
		}
	})

	it.each(["not-current", "not-location", "unbuilt", "ended", "deleted", "hidden"])(
		"stops %s reports without building orders or writing",
		async (state) => {
			if (state === "not-location") await setSeasonField("season", target, null)
			if (state === "unbuilt") await teams.setTeamField(team._id, "questOrder", [])
			if (state === "ended") await setSeasonField("season", { field: "end" }, now)
			if (state === "deleted") await (await collections()).teams.deleteOne({ _id: team._id })
			if (state === "hidden") await setSeasonField("season", { ...target, field: "hidden" }, true)
			const before = await teams.getTeam(team._id)
			const events: string[] = []
			const unsubscribe = subscribe([livePositionsChannel("season")], ({ channel }) => events.push(channel))
			try {
				expect(await reportPosition(team, "phone", state === "not-current" ? "elsewhere" : quest.id, fix, now)).toEqual(
					{
						status: "stop",
					},
				)
				expect(await teams.getTeam(team._id)).toEqual(before)
				expect(latestFixes(team._id, now.getTime()).size).toBe(0)
				await vi.advanceTimersByTimeAsync(1000)
				expect(events).toEqual([])
			} finally {
				unsubscribe()
			}
		},
	)

	it("retries hint races using latest penalties", async () => {
		await setSeasonField("season", { ...target, field: "drop" }, { fullMinutes: 5, dropMinutes: 10, floor: 10 })
		await teams.setTeamField(team._id, "reachedAt", new Date(now.getTime() - 600_000))
		const original = teams.solveCurrentQuest
		vi.spyOn(teams, "solveCurrentQuest").mockImplementationOnce(async (...args) => {
			await teams.revealHint(
				team._id,
				{ questId: quest.id, questIndex: 0 },
				{ hintId: "new", text: "Hint", points: 8, revealedAt: now },
			)
			return original(...args)
		})
		expect(await reportPosition(team, "phone", quest.id, fix, now)).toEqual({ status: "solved", pointsEarned: 22 })
	})

	it.each(["move", "remove"])("rechecks location when %s wins a race with solving", async (edit) => {
		const original = teams.solveCurrentQuest
		vi.spyOn(teams, "solveCurrentQuest").mockImplementationOnce(async (...args) => {
			await setSeasonField(
				"season",
				target,
				edit === "remove"
					? null
					: {
							...location,
							places: [{ ...place, lat: 56 }],
						},
			)
			return original(...args)
		})
		expect(await reportPosition(team, "phone", quest.id, fix, now)).toEqual({
			status: edit === "remove" ? "stop" : "outside",
		})
		expect(await teams.getTeam(team._id)).toEqual(team)
	})

	it("keeps backup answers and guards solved earnings by team and quest kind", async () => {
		expect(await submitAnswer(team, quest.id, "backup", now)).toMatchObject({ correct: true, pointsEarned: 50 })
		expect(await getSolvedLocation(team, quest.id)).toEqual({ pointsEarned: 50 })
		const other = await teams.createTeam({ ...team, _id: "other", name: "Other" })
		expect(await getSolvedLocation(other, quest.id)).toBeNull()
		await (await collections()).seasons.updateOne({ _id: "season" }, { $set: { "arcs.0.quests.0.location": null } })
		expect(await getSolvedLocation(team, quest.id)).toBeNull()
	})

	it("guards solved-location action before reads", async () => {
		vi.mocked(requireTeam).mockRejectedValue(new Error("Unauthorized"))
		await expect(actions.getSolvedLocation(quest.id)).rejects.toThrow("Unauthorized")
	})
})

describe("location authoring", () => {
	it.each(["none", "warmer", "map"] as const)(
		"allows %s guidance before solving and locks all guidance changes after a solve",
		async (guidance) => {
			const changed: Location = { ...location, guidance }
			expect(await saveSeasonField("season", target, changed)).toEqual({ ok: true })
			await reportPosition(team, "phone", quest.id, fix, now)
			for (const next of ["none", "warmer", "map"] as const) {
				expect(await saveSeasonField("season", target, { ...location, guidance: next })).toEqual(
					next === guidance
						? { ok: true }
						: {
								ok: false,
								error: "Locked: a team has found this place.",
							},
				)
			}
			expect((await getSeason("season"))?.arcs[0]?.quests[0]?.location).toEqual(changed)
		},
	)

	it("serializes place edits behind an in-flight solve so solved places stay locked", async () => {
		const db = await collections()
		vi.spyOn(database, "collections").mockResolvedValue(db)
		const started = Promise.withResolvers<void>()
		const resume = Promise.withResolvers<void>()
		const originalWrite = db.teams.updateOne.bind(db.teams)
		vi.spyOn(db.teams, "updateOne").mockImplementation(async (...args) => {
			if ("$inc" in args[1] && args[1].$inc?.questIndex) {
				started.resolve()
				await resume.promise
			}
			return originalWrite(...args)
		})
		const solve = reportPosition(team, "phone", quest.id, fix, now)
		await started.promise
		const queued = Promise.withResolvers<string>()
		const originalLock = structure.withSeasonStructure
		vi.spyOn(structure, "withSeasonStructure").mockImplementation((...args) => {
			queued.resolve("queued")
			return originalLock(...args)
		})
		const edit = setSeasonField("season", target, null)
		const outcome = edit.then(
			() => "edited",
			() => "rejected",
		)
		try {
			expect(await Promise.race([queued.promise, outcome])).toBe("queued")
		} finally {
			resume.resolve()
			await solve
			await outcome
		}
		await expect(edit).rejects.toThrow("Locked: a team has found this place.")
	})

	it.each(["none", "map"] as const)(
		"allows %s place edits before solving, locks changes after solving, keeps answers editable",
		async (guidance) => {
			const changed: Location = { guidance, places: [{ ...place, radius: 60 }] }
			expect(await saveSeasonField("season", target, changed)).toEqual({ ok: true })
			await reportPosition(team, "phone", quest.id, fix, now)
			for (const value of [null, location, { ...changed, places: [{ ...place, radius: 60, lat: 56 }] }]) {
				expect(await saveSeasonField("season", target, value)).toEqual({
					ok: false,
					error: "Locked: a team has found this place.",
				})
			}
			expect(await saveSeasonField("season", target, changed)).toEqual({ ok: true })
			expect(await patchSeasonList("season", { ...target, field: "answers" }, { op: "add", value: "another" })).toEqual(
				{
					ok: true,
				},
			)
			expect((await getSeason("season"))?.arcs[0]?.quests[0]?.answers).toContain("another")
		},
	)

	it("locks additions, removals and edits to every place after a solve", async () => {
		const twoPlaces = mapLocation(2)
		expect(await saveSeasonField("season", target, twoPlaces)).toEqual({ ok: true })
		expect(await submitAnswer(team, quest.id, "backup", now)).toMatchObject({ correct: true })
		for (const changed of [
			mapLocation(3),
			{ ...twoPlaces, places: twoPlaces.places.slice(0, 1) },
			{ ...twoPlaces, places: twoPlaces.places.map((place, index) => (index ? { ...place, lat: 56 } : place)) },
		]) {
			expect(await saveSeasonField("season", target, changed)).toEqual({
				ok: false,
				error: "Locked: a team has found this place.",
			})
		}
		expect((await getSeason("season"))?.arcs[0]?.quests[0]?.location).toEqual(twoPlaces)
	})

	it.each(["none", "map"] as const)(
		"rejects puzzle and %s location together in either direction, including concurrent edits",
		async (guidance) => {
			const location: Location = { guidance, places: [place] }
			await teams.setTeamField(team._id, "questOrder", ["first", quest.id])
			await setSeasonField("season", { ...target, field: "assetPath" }, "/assets/image.png")
			const puzzleTarget = { ...target, field: "puzzle" } as const
			const puzzle = { rows: 2, cols: 2, showFull: false }
			expect((await saveSeasonField("season", puzzleTarget, puzzle)).ok).toBe(false)
			await setSeasonField("season", target, null)
			await setSeasonField("season", puzzleTarget, puzzle)
			expect((await saveSeasonField("season", target, location)).ok).toBe(false)
			await setSeasonField("season", puzzleTarget, null)
			const results = await Promise.all([
				saveSeasonField("season", target, location),
				saveSeasonField("season", puzzleTarget, puzzle),
			])
			expect(results.filter(({ ok }) => ok)).toHaveLength(1)
		},
	)

	it("validates season radius bounds without changing existing places", async () => {
		for (const value of [4, 501, 5.1, "40", null])
			expect((await saveSeasonField("season", { field: "placeRadius" }, value)).ok).toBe(false)
		for (const value of [5, 500])
			expect(await saveSeasonField("season", { field: "placeRadius" }, value)).toEqual({ ok: true })
		expect((await getSeason("season"))?.placeRadius).toBe(500)
		expect((await getSeason("season"))?.arcs[0]?.quests[0]?.location).toEqual(location)
	})

	it("guards location and radius saves before writes", async () => {
		vi.mocked(requireAdmin).mockRejectedValue(new Error("Unauthorized"))
		await expect(saveSeasonField("season", target, null)).rejects.toThrow("Unauthorized")
		await expect(saveSeasonField("season", target, { ...location, guidance: "map" })).rejects.toThrow("Unauthorized")
		await expect(saveSeasonField("season", { field: "placeRadius" }, 10)).rejects.toThrow("Unauthorized")
		expect((await getSeason("season"))?.arcs[0]?.quests[0]?.location).toEqual(location)
	})

	it("copies location through guarded quest copying without team progress", async () => {
		await createSeason({
			_id: "destination",
			title: "Next",
			lengthMinutes: 60,
			start: null,
			end: null,
			shuffleArcs: false,
			arcs: [],
		})
		const result = await copyQuest("season", quest.id, { seasonId: "destination", newArc: true })
		expect(result.ok).toBe(true)
		const copied = (await getSeason("destination"))?.arcs[0]?.quests[0]
		expect(copied?.location).toEqual(location)
		expect(copied?.id).not.toBe(quest.id)
	})
})
