import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { newQuest } from "@/lib/domain/season-tree"
import { loadLivePhones } from "@/lib/game/live-map"
import { clearTeamFixes, recordFix } from "@/lib/game/location-fixes"
import { useTestDb } from "@/test/db"
import { collections } from "./collections"
import { ensurePhone, listPhonesForTeams, renamePhone } from "./phones"
import { createSeason, setSeasonField } from "./seasons"
import { createTeam } from "./teams"

useTestDb()
const now = new Date("2026-10-29T17:00:00Z")
const sharedId = crypto.randomUUID()
const fix = { lat: 55, lng: 13, accuracy: 10, at: now.getTime() - 1000 }
const mapArea = { lat: 55, lng: 13, zoom: 12 }
const places = [
	{ id: "place-secret-1", lat: 55.5, lng: 13.2, radius: 40 },
	{ id: "place-secret-2", lat: 55.51, lng: 13.21, radius: 35 },
	{ id: "place-secret-3", lat: 55.52, lng: 13.22, radius: 30 },
]
const livePlaces = places.map(({ lat, lng, radius }, index) => ({
	lat,
	lng,
	radius,
	number: index + 1,
	teamIds: ["alpha", "zulu"],
}))

beforeEach(async () => {
	const db = await collections()
	await db.seasons.deleteMany({})
	await db.teams.deleteMany({})
	await db.phones.deleteMany({})
	await createSeason({
		_id: "season",
		title: "Live",
		lengthMinutes: 60,
		start: new Date(now.getTime() - 1000),
		end: new Date(now.getTime() + 3_600_000),
		shuffleArcs: false,
		mapArea,
		arcs: [
			{
				id: "arc",
				title: "Arc",
				shuffleQuests: false,
				quests: [
					{ ...newQuest(20), id: "quest-secret", answers: ["answer-secret"], location: { guidance: "map", places } },
				],
			},
		],
	})
	for (const [id, name, seasonId] of [
		["zulu", "Zulu", "season"],
		["alpha", "Alpha", "season"],
		["quiet", "Quiet", "season"],
		["other", "Other", "elsewhere"],
	] as const) {
		await createTeam({
			_id: id,
			name,
			seasonId,
			passwordHash: "team-secret",
			questOrder: id === "quiet" ? [] : ["quest-secret"],
			questIndex: 0,
			score: 0,
			completed: false,
			progress: [],
		})
	}
})

afterEach(() => {
	for (const id of ["alpha", "zulu", "quiet", "other"]) clearTeamFixes(id)
})

describe("live phone data", () => {
	it("joins nicknames by team and phone, drops orphan and foreign fixes, and whitelists every field", async () => {
		const alpha = (await ensurePhone("alpha", sharedId, now)).phone
		const zulu = (await ensurePhone("zulu", sharedId, now)).phone
		await renamePhone("alpha", sharedId, "Keen Fox")
		await renamePhone("zulu", sharedId, "Calm Owl")
		await ensurePhone("other", sharedId, now)
		await ensurePhone("quiet", crypto.randomUUID(), now)
		for (const teamId of ["alpha", "zulu", "other"]) recordFix(teamId, sharedId, fix, now.getTime())
		recordFix("alpha", "no-record", fix, now.getTime())
		const payload = await loadLivePhones("season", now)
		expect(payload).toEqual({
			live: true,
			mapArea,
			teams: [
				{ id: "alpha", name: "Alpha" },
				{ id: "quiet", name: "Quiet" },
				{ id: "zulu", name: "Zulu" },
			],
			places: livePlaces,
			phones: [
				{ id: alpha._id, teamId: "alpha", name: "Keen Fox", lat: 55, lng: 13, accuracy: 10, expiresInMs: 29_000 },
				{ id: zulu._id, teamId: "zulu", name: "Calm Owl", lat: 55, lng: 13, accuracy: 10, expiresInMs: 29_000 },
			],
		})
		expect(JSON.stringify(payload)).not.toMatch(
			/phoneId|receivedAt|createdAt|lastSeenAt|passwordHash|team-secret|place-secret|quest-secret|questId|answers|answer-secret|"at"/,
		)
		expect(JSON.stringify(payload)).not.toContain(sharedId)
		expect(await listPhonesForTeams(["alpha", "zulu"])).toHaveLength(2)
		expect(await listPhonesForTeams([])).toEqual([])
	})

	it("includes current places before any phones report", async () => {
		expect(await loadLivePhones("season", now)).toEqual({
			live: true,
			mapArea,
			teams: [
				{ id: "alpha", name: "Alpha" },
				{ id: "quiet", name: "Quiet" },
				{ id: "zulu", name: "Zulu" },
			],
			places: livePlaces,
			phones: [],
		})
	})

	it("omits expired phones, keeps the exact lifetime boundary and handles absent map areas", async () => {
		await ensurePhone("alpha", sharedId, now)
		recordFix("alpha", sharedId, fix, now.getTime())
		await setSeasonField("season", { field: "mapArea" }, null)
		const boundary = await loadLivePhones("season", new Date(now.getTime() + 29_000))
		expect(boundary).toMatchObject({ live: true, mapArea: null, phones: [{ expiresInMs: 0 }] })
		expect(await loadLivePhones("season", new Date(now.getTime() + 29_001))).toMatchObject({ live: true, phones: [] })
	})

	it.each(["upcoming", "ended", "unscheduled", "missing"])("returns only live false when %s", async (state) => {
		await ensurePhone("alpha", sharedId, now)
		recordFix("alpha", sharedId, fix, now.getTime())
		const db = await collections()
		if (state === "upcoming")
			await db.seasons.updateOne({ _id: "season" }, { $set: { start: new Date(now.getTime() + 1) } })
		if (state === "ended") await db.seasons.updateOne({ _id: "season" }, { $set: { end: now } })
		if (state === "unscheduled") await db.seasons.updateOne({ _id: "season" }, { $set: { start: null } })
		if (state === "missing") await db.seasons.deleteOne({ _id: "season" })
		expect(await loadLivePhones("season", now)).toEqual({ live: false })
	})
})
