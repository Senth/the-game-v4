import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getSession } from "@/lib/auth/session"
import { collections } from "@/lib/db/collections"
import * as seasons from "@/lib/db/seasons"
import { newArc, newQuest } from "@/lib/domain/season-tree"
import { boardChannel, publish, seasonChannel } from "@/lib/events/bus"
import { useTestDb } from "@/test/db"
import { moveHint } from "./autosave-actions"
import { moveArc, moveQuest } from "./tree-actions"

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }))
vi.mock("next/cache", () => ({ refresh: vi.fn() }))
vi.mock("@/lib/events/bus", async (original) => ({
	...(await original<typeof import("@/lib/events/bus")>()),
	publish: vi.fn(),
}))
useTestDb()
const now = new Date("2026-10-24T16:00:00Z")
const moves = [
	{ name: "moveHint", run: moveHint, target: { seasonId: "season", id: "h1", beforeId: null } },
	{ name: "moveQuest", run: moveQuest, target: { seasonId: "season", id: "q1", toArcId: "a2", beforeId: null } },
	{ name: "moveArc", run: moveArc, target: { seasonId: "season", id: "a1", beforeId: null } },
] as const

beforeEach(async () => {
	vi.restoreAllMocks()
	vi.setSystemTime(now)
	const db = await collections()
	await db.seasons.deleteMany({})
	await db.admins.deleteMany({})
	await db.admins.insertOne({ _id: "admin", name: "admin", passwordHash: "hash" })
	vi.mocked(getSession)
		.mockReset()
		.mockResolvedValue({ kind: "admin", id: "admin" } as Awaited<ReturnType<typeof getSession>>)
	vi.mocked(publish).mockClear()
})
afterEach(() => vi.useRealTimers())

async function setup(start: Date | null = null) {
	return seasons.createSeason({
		_id: "season",
		title: "Cipher Night",
		lengthMinutes: 60,
		start,
		end: start ? new Date(start.getTime() + 3_600_000) : null,
		shuffleArcs: false,
		arcs: [
			{
				...newArc(false),
				id: "a1",
				quests: [
					{
						...newQuest(),
						id: "q1",
						hints: [
							{ id: "h1", text: "First", points: 5 },
							{ id: "h2", text: "Second", points: 10 },
						],
					},
				],
			},
			{ ...newArc(false), id: "a2" },
		],
	})
}

describe.each(moves)("$name", ({ name, run, target }) => {
	it.each([{}, { kind: "team", id: "team" }])("rejects session %j before validation", async (session) => {
		const season = await setup()
		vi.mocked(getSession).mockResolvedValueOnce(session as Awaited<ReturnType<typeof getSession>>)
		await expect(run(null as never)).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") })
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it.each([null, new Date(now.getTime() + 60_000)])(
		"writes before start %j and publishes only after success",
		async (start) => {
			await setup(start)
			const original =
				name === "moveHint" ? seasons.moveHint : name === "moveQuest" ? seasons.moveQuest : seasons.moveArc
			vi.spyOn(seasons, name).mockImplementationOnce(async (input: seasons.MoveTarget, date?: Date) => {
				expect(publish).not.toHaveBeenCalled()
				await original(input as Parameters<typeof seasons.moveQuest>[0], date as Date)
				expect(publish).not.toHaveBeenCalled()
			})
			expect(await run(target as Parameters<typeof moveQuest>[0])).toEqual({ ok: true })
			expect(vi.mocked(publish).mock.calls).toEqual([[seasonChannel("season")], [boardChannel]])
		},
	)

	it.each([now, new Date(now.getTime() - 3_600_000)])(
		"uses live error shape for started season %j, except hints",
		async (start) => {
			const season = await setup(start)
			expect(await run(target as Parameters<typeof moveQuest>[0])).toEqual(
				name === "moveHint" ? { ok: true } : { ok: false, error: "The game has started." },
			)
			if (name !== "moveHint") {
				expect(await seasons.getSeason(season._id)).toEqual(season)
				expect(publish).not.toHaveBeenCalled()
			}
		},
	)

	it("validates every input field and rejects whole arrays before writing", async () => {
		const season = await setup()
		const write = vi.spyOn(seasons, name)
		for (const key of Object.keys(target)) {
			for (const value of ["", 42, [], undefined]) {
				expect(await run({ ...target, [key]: value } as Parameters<typeof moveQuest>[0])).toEqual({
					ok: false,
					error: "Invalid value.",
				})
			}
		}
		const wholeArray = { ...target, arcs: [] }
		expect(await run(wholeArray as Parameters<typeof moveQuest>[0])).toEqual({
			ok: false,
			error: "Invalid value.",
		})
		expect(write).not.toHaveBeenCalled()
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it("returns a typed conflict without publishing when the moved id is gone", async () => {
		const season = await setup()
		expect(await run({ ...target, id: "missing" } as Parameters<typeof moveQuest>[0])).toEqual({
			ok: false,
			error: "Not saved, retry",
			conflict: true,
		})
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it("rethrows unexpected failures without publishing", async () => {
		const error = new Error("Database unavailable")
		vi.spyOn(seasons, name).mockRejectedValueOnce(error)
		await expect(run(target as Parameters<typeof moveQuest>[0])).rejects.toBe(error)
		expect(publish).not.toHaveBeenCalled()
	})
})
