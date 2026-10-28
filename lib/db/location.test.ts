import { beforeEach, describe, expect, it, vi } from "vitest"
import * as actions from "@/app/actions"
import { patchSeasonList, saveSeasonField } from "@/app/admin/autosave-actions"
import { copyQuest } from "@/app/admin/copy-actions"
import { requireAdmin, requireTeam } from "@/lib/auth/guards"
import type { Location, Team } from "@/lib/domain/schemas"
import { newQuest } from "@/lib/domain/season-tree"
import { boardChannel, seasonChannel, subscribe, teamChannel } from "@/lib/events/bus"
import { getSolvedLocation, loadGame, reportPosition, submitAnswer } from "@/lib/game/game"
import { latestFixes } from "@/lib/game/location-fixes"
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

describe("location reports", () => {
	it.each(["none", "warmer"] as const)(
		"solves once across phones and retries with %s guidance, stored hint penalties, one bonus and all live channels",
		async (guidance) => {
			await setSeasonField("season", target, { ...location, guidance })
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
				expect(results.filter(({ status }) => status === "solved")).toEqual([{ status: "solved", pointsEarned: 43 }])
				expect(results.filter(({ status }) => status === "stop")).toHaveLength(7)
				expect(await reportPosition(team, "phone-0", quest.id, fix, now)).toEqual({ status: "stop" })
				expect(await teams.getTeam(team._id)).toMatchObject({
					score: 63,
					questIndex: 1,
					completed: true,
					progress: [{ questId: quest.id, solvedAt: now, pointsEarned: 43 }],
				})
				expect((await getSeason("season"))?.finishers).toEqual([{ teamId: team._id, place: 1, points: 20, at: now }])
				expect(events).toEqual(channels)
				expect(await actions.getSolvedLocation(quest.id)).toEqual({ pointsEarned: 43 })
				await setSeasonField("season", { ...target, field: "points" }, 100)
				expect(await getSolvedLocation(team, quest.id)).toEqual({ pointsEarned: 43 })
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

	it("returns only phone-local guidance without writes, events or guidance in game data", async () => {
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
	] as const)("%s fixes never write or publish", async (status, report) => {
		const before = await teams.getTeam(team._id)
		const events: string[] = []
		const unsubscribe = subscribe([teamChannel(team._id), seasonChannel("season"), boardChannel], ({ channel }) =>
			events.push(channel),
		)
		try {
			expect(await reportPosition(team, "phone", quest.id, report, now)).toEqual({ status })
			expect(await teams.getTeam(team._id)).toEqual(before)
			expect(events).toEqual([])
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
			expect(await reportPosition(team, "phone", state === "not-current" ? "elsewhere" : quest.id, fix, now)).toEqual({
				status: "stop",
			})
			expect(await teams.getTeam(team._id)).toEqual(before)
			expect(latestFixes(team._id, now.getTime()).size).toBe(0)
		},
	)

	it("retries hint races using latest penalties", async () => {
		const original = teams.solveCurrentQuest
		vi.spyOn(teams, "solveCurrentQuest").mockImplementationOnce(async (...args) => {
			await teams.revealHint(
				team._id,
				{ questId: quest.id, questIndex: 0 },
				{ hintId: "new", text: "Hint", points: 8, revealedAt: now },
			)
			return original(...args)
		})
		expect(await reportPosition(team, "phone", quest.id, fix, now)).toEqual({ status: "solved", pointsEarned: 42 })
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
