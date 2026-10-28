import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { collections } from "@/lib/db/collections"
import { ensurePhone, renamePhone } from "@/lib/db/phones"
import * as seasons from "@/lib/db/seasons"
import { createTeam, setTeamField } from "@/lib/db/teams"
import { fixTtlMs, positionsPushMs } from "@/lib/domain/location"
import type { Team } from "@/lib/domain/schemas"
import { newQuest } from "@/lib/domain/season-tree"
import { positionsChannel, subscribe } from "@/lib/events/bus"
import { useTestDb } from "@/test/db"
import { clearTeamFixes, recordFix } from "./location-fixes"
import { clearPositions, type Positions, schedulePositions } from "./positions"

useTestDb()

const now = new Date("2026-10-28T18:00:00Z")
const firstPhone = crypto.randomUUID()
const secondPhone = crypto.randomUUID()
const place = { id: "secret-place", lat: 55.5079, lng: 13.2353, radius: 40 }
const location = {
	guidance: "map" as const,
	places: [place, { ...place, id: "secret-place-2", lat: place.lat + 0.002 }],
}
let team: Team
let events: Positions[]
let unsubscribe: () => void

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
	vi.setSystemTime(now)
	const season = await seasons.createSeason({
		title: "Positions",
		lengthMinutes: 60,
		start: new Date(now.getTime() - 1000),
		end: new Date(now.getTime() + 3_600_000),
		shuffleArcs: false,
		arcs: [{ id: "arc", title: "Arc", shuffleQuests: false, quests: [{ ...newQuest(50), id: "quest", location }] }],
	})
	team = await createTeam({
		name: "Players",
		passwordHash: "x",
		seasonId: season._id,
		questOrder: ["quest"],
		questIndex: 0,
		score: 0,
		completed: false,
		progress: [],
	})
	for (const [phone, name] of [
		[firstPhone, "Keen Otter"],
		[secondPhone, "Brave Badger"],
	] as const) {
		await ensurePhone(team._id, phone, now)
		await renamePhone(team._id, phone, name)
	}
	events = []
	unsubscribe = subscribe([positionsChannel(team._id)], ({ data }) => events.push(data as Positions))
})

afterEach(() => {
	unsubscribe()
	clearTeamFixes(team._id)
	clearPositions(team._id)
	vi.clearAllTimers()
	vi.useRealTimers()
	vi.restoreAllMocks()
})

function fix(phone: string, index: number, at = Date.now()) {
	recordFix(team._id, phone, { ...place, lat: place.lat + index * 0.002, accuracy: 10, at })
}

async function nextPush(elapsed: number) {
	const next = Promise.withResolvers<void>()
	const stop = subscribe([positionsChannel(team._id)], () => next.resolve())
	try {
		await vi.advanceTimersByTimeAsync(elapsed)
		await next.promise
	} finally {
		stop()
	}
}

describe("positions pushes", () => {
	it("whitelists payloads, joins only this team's names and uses one coverage assignment without DB writes", async () => {
		const db = await collections()
		const before = await Promise.all([
			db.teams.find({}).toArray(),
			db.seasons.find({}).toArray(),
			db.phones.find({}).toArray(),
		])
		fix(firstPhone, 0)
		fix(secondPhone, 1)
		recordFix("other-team", "other-phone", { ...place, accuracy: 10, at: Date.now() })
		await schedulePositions(team._id)
		expect(events).toEqual([
			{
				places: [{ held: true }, { held: true }],
				phones: [
					{ name: "Keen Otter", lat: place.lat, lng: place.lng, ageMs: 0, place: 1 },
					{ name: "Brave Badger", lat: place.lat + 0.002, lng: place.lng, ageMs: 0, place: 2 },
				],
			},
		])
		expect(JSON.stringify(events)).not.toMatch(/secret|other|accuracy|radius|phoneId|teamId|receivedAt|"at"|history/)
		expect(JSON.stringify(events)).not.toContain(firstPhone)
		expect(JSON.stringify(events)).not.toContain(secondPhone)
		expect(
			await Promise.all([db.teams.find({}).toArray(), db.seasons.find({}).toArray(), db.phones.find({}).toArray()]),
		).toEqual(before)
	})

	it("coalesces reports until exactly five seconds, sends latest fixes, then permits an immediate push after a quiet interval", async () => {
		fix(firstPhone, 0)
		await schedulePositions(team._id)
		await vi.advanceTimersByTimeAsync(1000)
		fix(secondPhone, 1)
		await Promise.all([schedulePositions(team._id), schedulePositions(team._id)])
		await vi.advanceTimersByTimeAsync(positionsPushMs - 1001)
		expect(events).toHaveLength(1)
		await nextPush(1)
		expect(events).toHaveLength(2)
		expect(events[1]?.phones.map(({ ageMs }) => ageMs)).toEqual([5000, 4000])
		await vi.advanceTimersByTimeAsync(positionsPushMs)
		fix(secondPhone, 3)
		await schedulePositions(team._id)
		expect(events).toHaveLength(3)
		expect(events[2]?.places).toEqual([{ held: true }, { held: false }])
		expect(events[2]?.phones[1]).not.toHaveProperty("place")
	})

	it("expires the oldest fix despite a fresh receipt, respecting the throttle, then drops future-dated fixes after their receipt lifetime", async () => {
		fix(firstPhone, 0, Date.now() - fixTtlMs + 1000)
		fix(secondPhone, 1, Date.now() + fixTtlMs)
		await schedulePositions(team._id)
		expect(events[0]?.phones.map(({ ageMs }) => ageMs)).toEqual([29000, 0])
		await vi.advanceTimersByTimeAsync(positionsPushMs - 1)
		expect(events).toHaveLength(1)
		await nextPush(1)
		expect(events[1]).toEqual({
			places: [{ held: false }, { held: true }],
			phones: [{ name: "Brave Badger", lat: place.lat + 0.002, lng: place.lng, ageMs: 5000, place: 2 }],
		})
		await vi.advanceTimersByTimeAsync(fixTtlMs - positionsPushMs)
		expect(events).toHaveLength(2)
		await nextPush(1)
		expect(events[2]).toEqual({ places: [{ held: false }, { held: false }], phones: [] })
		await vi.advanceTimersByTimeAsync(positionsPushMs)
		expect(vi.getTimerCount()).toBe(0)
	})

	it.each(["none", "warmer", "no-location", "ended", "waiting", "completed", "hidden"])(
		"suppresses queued pushes when current play becomes %s",
		async (state) => {
			fix(firstPhone, 0)
			await schedulePositions(team._id)
			await schedulePositions(team._id)
			if (state === "none" || state === "warmer")
				await seasons.setSeasonField(
					team.seasonId,
					{ arcId: "arc", questId: "quest", field: "location" },
					{ guidance: state, places: [place] },
				)
			if (state === "no-location")
				await seasons.setSeasonField(team.seasonId, { arcId: "arc", questId: "quest", field: "location" }, null)
			if (state === "ended") await seasons.setSeasonField(team.seasonId, { field: "end" }, now)
			if (state === "waiting") await seasons.setSeasonField(team.seasonId, { field: "start" }, null)
			if (state === "completed") await setTeamField(team._id, "completed", true)
			if (state === "hidden")
				await seasons.setSeasonField(team.seasonId, { arcId: "arc", questId: "quest", field: "hidden" }, true)
			await vi.advanceTimersByTimeAsync(positionsPushMs)
			await schedulePositions(team._id)
			expect(events).toHaveLength(1)
		},
	)

	it("queues a throttled empty payload and cancels a queued expiry or a push already awaiting DB reads", async () => {
		fix(firstPhone, 0)
		await schedulePositions(team._id)
		await schedulePositions(team._id)
		clearTeamFixes(team._id)
		clearPositions(team._id)
		expect(events).toHaveLength(1)
		await nextPush(positionsPushMs)
		expect(events.at(-1)).toEqual({ places: [], phones: [] })
		await vi.advanceTimersByTimeAsync(fixTtlMs + 1)
		expect(events).toHaveLength(2)
		const started = Promise.withResolvers<void>()
		const resume = Promise.withResolvers<void>()
		const original = seasons.getSeason
		vi.spyOn(seasons, "getSeason").mockImplementationOnce(async (...args) => {
			started.resolve()
			await resume.promise
			return original(...args)
		})
		fix(firstPhone, 0)
		const pending = schedulePositions(team._id)
		await started.promise
		clearTeamFixes(team._id)
		clearPositions(team._id)
		resume.resolve()
		await pending
		expect(events).toHaveLength(3)
		expect(events.at(-1)).toEqual({ places: [], phones: [] })
	})
})
