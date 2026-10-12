import { redirect } from "next/navigation"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { requireAdmin } from "@/lib/auth/guards"
import { collections } from "@/lib/db/collections"
import * as seasons from "@/lib/db/seasons"
import type { Season } from "@/lib/domain/schemas"
import { boardChannel, publish, seasonChannel } from "@/lib/events/bus"
import { useTestDb } from "@/test/db"
import { endSeason, setSeasonRegistration, shiftSeasonEnd, startSeasonNow } from "./live-actions"

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/events/bus", async (original) => ({
	...(await original<typeof import("@/lib/events/bus")>()),
	publish: vi.fn(),
}))

useTestDb()
const now = new Date("2026-10-24T16:00:00Z")
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000)

beforeEach(async () => {
	vi.restoreAllMocks()
	vi.setSystemTime(now)
	await (await collections()).seasons.deleteMany({})
	vi.mocked(requireAdmin).mockReset().mockResolvedValue({ _id: "admin", name: "admin", passwordHash: "hash" })
	vi.mocked(publish).mockClear()
})

afterEach(() => vi.useRealTimers())

async function setup(input: Partial<Omit<Season, "_id" | "registrationOpen">> = {}) {
	return seasons.createSeason({
		title: "Cipher Night",
		lengthMinutes: 60,
		start: null,
		end: null,
		shuffleArcs: false,
		arcs: [
			{
				id: "a1",
				title: "Arc",
				shuffleQuests: false,
				quests: [
					{
						id: "q1",
						displayTitle: "Beacon",
						internalTitle: "beacon",
						content: "Decode",
						assetPath: null,
						answers: ["lamp"],
						points: 50,
						adminNotes: "",
						hints: [],
					},
				],
			},
		],
		...input,
	})
}

const actions = {
	start: (seasonId: string) => startSeasonNow(seasonId),
	shift: (seasonId: string) => shiftSeasonEnd(seasonId, 5),
	end: (seasonId: string) => endSeason(seasonId),
	registration: (seasonId: string) => setSeasonRegistration(seasonId, true),
}

describe("live actions", () => {
	it.each(Object.entries(actions))(
		"%s guards before reading or writing and preserves redirects",
		async (_name, action) => {
			const season = await setup()
			vi.mocked(requireAdmin).mockImplementationOnce(async () => redirect("/login"))
			const read = vi.spyOn(seasons, "getSeason")
			await expect(action(season._id)).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") })
			expect(read).not.toHaveBeenCalled()
			expect(await seasons.getSeason(season._id)).toEqual(season)
			expect(publish).not.toHaveBeenCalled()
		},
	)

	it.each(Object.entries(actions))("%s rejects invalid or missing ids without publishing", async (_name, action) => {
		expect(await action("")).toEqual({ ok: false, error: "Invalid value." })
		expect(await action("missing")).toEqual({ ok: false, error: "Season missing not found" })
		expect(publish).not.toHaveBeenCalled()
	})

	it.each(["start", "shrink", "extend", "end", "reopen", "open", "close"])(
		"%s writes the expected window and publishes both channels once",
		async (action) => {
			const season = await setup(
				action === "start" || action === "open" || action === "close"
					? {}
					: {
							start: at(-10),
							end: action === "reopen" ? at(-1) : at(10),
						},
			)
			let expected: Partial<Season>
			let result: Awaited<ReturnType<typeof startSeasonNow>>
			if (action === "start") {
				result = await startSeasonNow(season._id)
				expected = { start: new Date(now.getTime() + 20_000), end: new Date(now.getTime() + 3_620_000) }
			} else if (action === "end") {
				result = await endSeason(season._id)
				expected = { start: season.start, end: now }
			} else if (action === "open" || action === "close") {
				result = await setSeasonRegistration(season._id, action === "open")
				expected = { registrationOpen: action === "open" }
			} else {
				result = await shiftSeasonEnd(season._id, action === "shrink" ? -5 : 5)
				expected = { start: season.start, end: at(action === "extend" ? 15 : 5) }
			}
			expect(result).toEqual({ ok: true })
			expect(await seasons.getSeason(season._id)).toMatchObject(expected)
			expect(vi.mocked(publish).mock.calls).toEqual([[seasonChannel(season._id)], [boardChannel]])
		},
	)

	it("Start now replaces an upcoming schedule", async () => {
		const season = await setup({ start: at(120), end: at(180) })
		expect(await startSeasonNow(season._id)).toEqual({ ok: true })
		expect(await seasons.getSeason(season._id)).toMatchObject({ start: new Date(now.getTime() + 20_000) })
	})

	it("refuses Start now without quests with shared copy", async () => {
		const season = await setup({ arcs: [] })
		expect(await startSeasonNow(season._id)).toEqual({ ok: false, error: "Add a quest first." })
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it.each(["start", "extend", "reopen"])("%s refuses overlaps using scheduled shared copy", async (action) => {
		const season = await setup(action === "start" ? {} : { start: at(-60), end: action === "reopen" ? at(-1) : at(2) })
		await setup({ title: "Spring Hunt", start: at(3), end: at(63) })
		expect(await (action === "start" ? startSeasonNow(season._id) : shiftSeasonEnd(season._id, 5))).toEqual({
			ok: false,
			error: 'Overlaps "Spring Hunt", Sat 24 Oct 18:03–19:03.',
		})
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it("names another live season", async () => {
		const season = await setup()
		await setup({ title: "Spring Hunt", start: at(-1), end: at(30) })
		expect(await startSeasonNow(season._id)).toEqual({ ok: false, error: '"Spring Hunt" is live. End it first.' })
		expect(publish).not.toHaveBeenCalled()
	})

	it.each(["unscheduled", "upcoming", "five minutes", "ended"])("refuses shrink when %s", async (state) => {
		const season = await setup(
			state === "unscheduled"
				? {}
				: {
						start: at(state === "upcoming" ? 10 : -10),
						end: at(state === "ended" ? -1 : 5),
					},
		)
		expect(await shiftSeasonEnd(season._id, -5)).toEqual({ ok: false, error: "Invalid live control." })
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it.each(["start", "end"] as const)("refuses %s in the wrong lifecycle state", async (action) => {
		const season = await setup(action === "start" ? { start: at(-10), end: at(10) } : {})
		expect(await actions[action](season._id)).toEqual({
			ok: false,
			error: action === "start" ? "Set at start. Use −5 / +5 min while live." : "Invalid live control.",
		})
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it("rejects invalid delta and registration values without writing", async () => {
		const season = await setup({ start: at(-10), end: at(10) })
		expect(await shiftSeasonEnd(season._id, 10 as 5)).toEqual({ ok: false, error: "Invalid value." })
		expect(await setSeasonRegistration(season._id, "true" as unknown as boolean)).toEqual({
			ok: false,
			error: "Invalid value.",
		})
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it("returns registration conflict and ended-season errors", async () => {
		const open = await setup({ title: "Spring Hunt" })
		await seasons.setRegistrationOpen(open._id, true, now)
		const season = await setup()
		expect(await setSeasonRegistration(season._id, true)).toEqual({
			ok: false,
			error: 'Registration is already open for "Spring Hunt"',
		})
		await seasons.setRegistrationOpen(open._id, false, now)
		const ended = await setup({ start: at(-60), end: at(-1) })
		expect(await setSeasonRegistration(ended._id, true)).toEqual({
			ok: false,
			error: 'Season "Cipher Night" has ended',
		})
		expect(publish).not.toHaveBeenCalled()
	})

	it("refuses reopening registration while another season has it open", async () => {
		const season = await setup({ start: at(-60), end: at(-1) })
		await seasons.setRegistrationOpen(season._id, true, at(-2))
		const other = await setup({ title: "Spring Hunt" })
		await seasons.setRegistrationOpen(other._id, true, now)
		expect(await shiftSeasonEnd(season._id, 5)).toEqual({
			ok: false,
			error: 'Registration is already open for "Spring Hunt"',
		})
		expect(await seasons.getSeason(season._id)).toMatchObject({ end: season.end })
		expect(publish).not.toHaveBeenCalled()
	})

	it("returns stale-window failures and rethrows unexpected database errors", async () => {
		const season = await setup()
		vi.spyOn(seasons, "setSeasonWindow").mockRejectedValueOnce(new seasons.StaleWindowError("Season window changed"))
		expect(await startSeasonNow(season._id)).toEqual({ ok: false, error: "Season window changed" })
		const error = new Error("Database unavailable")
		vi.spyOn(seasons, "setRegistrationOpen").mockRejectedValueOnce(error)
		await expect(setSeasonRegistration(season._id, true)).rejects.toBe(error)
		expect(publish).not.toHaveBeenCalled()
	})
})
