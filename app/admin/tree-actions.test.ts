import { mkdtemp, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { refresh } from "next/cache"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { saveAsset } from "@/lib/assets/files"
import * as assets from "@/lib/assets/release"
import { getSession } from "@/lib/auth/session"
import { collections } from "@/lib/db/collections"
import * as seasons from "@/lib/db/seasons"
import { newArc, newQuest } from "@/lib/domain/season-tree"
import { boardChannel, publish, seasonChannel } from "@/lib/events/bus"
import { useTestDb } from "@/test/db"
import { addArc, addQuest, removeArc, removeQuest } from "./tree-actions"

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }))
vi.mock("next/cache", () => ({ refresh: vi.fn() }))
vi.mock("@/lib/events/bus", async (original) => ({
	...(await original<typeof import("@/lib/events/bus")>()),
	publish: vi.fn(),
}))

useTestDb()
const now = new Date("2026-10-24T16:00:00Z")
const ids = ["season", "arc", "quest"] as const
type Ids = [string, string, string]
const actions = [
	{ name: "addArc", run: ([seasonId]: Ids) => addArc(seasonId), count: 1 },
	{ name: "addQuest", run: ([seasonId, arcId]: Ids) => addQuest(seasonId, arcId), count: 2 },
	{ name: "removeArc", run: ([seasonId, arcId]: Ids) => removeArc(seasonId, arcId), count: 2 },
	{ name: "removeQuest", run: ([seasonId, arcId, questId]: Ids) => removeQuest(seasonId, arcId, questId), count: 3 },
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
	vi.mocked(refresh).mockReset()
})

afterEach(() => vi.useRealTimers())

async function setup(start: Date | null = null) {
	return seasons.createSeason({
		_id: ids[0],
		title: "Cipher Night",
		lengthMinutes: 60,
		start,
		end: start ? new Date(start.getTime() + 3_600_000) : null,
		shuffleArcs: false,
		arcs: [{ ...newArc(false), id: ids[1], quests: [{ ...newQuest(), id: ids[2] }] }],
	})
}

it("refreshes the season layout after quest creation before navigation can reuse it", async () => {
	const steps: string[] = []
	let finish!: (questId: string) => void
	const write = vi.spyOn(seasons, "addQuest").mockReturnValueOnce(
		new Promise((resolve) => {
			finish = resolve
		}),
	)
	vi.mocked(refresh).mockImplementationOnce(() => {
		steps.push("refresh")
	})
	const creating = addQuest(ids[0], ids[1]).then((result) => {
		if (result.ok) steps.push("navigate")
		return result
	})
	await vi.waitFor(() => expect(write).toHaveBeenCalled())
	expect(refresh).not.toHaveBeenCalled()
	steps.push("write")
	finish("new-quest")
	expect(await creating).toEqual({ ok: true, questId: "new-quest" })
	expect(refresh).toHaveBeenCalledExactlyOnceWith()
	expect(steps).toEqual(["write", "refresh", "navigate"])
})

describe("tree asset cleanup", () => {
	let directory: string
	beforeEach(async () => {
		directory = await mkdtemp(path.resolve(".tmp", "tree-assets-"))
		vi.stubEnv("ASSETS_DIR", directory)
	})
	afterEach(async () => {
		vi.unstubAllEnvs()
		await rm(directory, { recursive: true, force: true })
	})

	it.each(["quest", "arc"])("keeps committed %s removal and publishes when releaseAsset fails", async (kind) => {
		await setup()
		const first = await saveAsset(new Uint8Array([1]), "png")
		await seasons.setQuestAsset(...ids, first)
		if (kind === "arc") {
			const second = await saveAsset(new Uint8Array([2]), "pdf")
			const questId = await seasons.addQuest(ids[0], ids[1], now)
			await seasons.setQuestAsset(ids[0], ids[1], questId, second)
		}
		const error = new Error("Asset cleanup unavailable")
		const release = vi.spyOn(assets, "releaseAsset").mockRejectedValueOnce(error)
		const log = vi.spyOn(console, "error").mockImplementation(() => {})
		expect(await (kind === "quest" ? removeQuest(...ids) : removeArc(ids[0], ids[1]))).toEqual({ ok: true })
		const season = await seasons.getSeason(ids[0])
		expect(kind === "arc" ? season?.arcs : season?.arcs[0]?.quests).toEqual([])
		expect(release).toHaveBeenCalledWith(first)
		expect(release).toHaveBeenCalledTimes(kind === "arc" ? 2 : 1)
		expect(log).toHaveBeenCalledExactlyOnceWith("Failed to release asset", first, error)
		expect(await readdir(directory)).toEqual([path.basename(first)])
		expect(vi.mocked(publish).mock.calls).toEqual([[seasonChannel(ids[0])], [boardChannel]])
	})

	it.each(["quest", "arc"])("removing %s deletes all unreferenced files and keeps shared files", async (kind) => {
		const season = await setup()
		const first = await saveAsset(new Uint8Array([1]), "png")
		await seasons.setQuestAsset(...ids, first)
		const other = await seasons.createSeason({ ...season, _id: "other" })
		await seasons.setQuestAsset(other._id, ids[1], ids[2], first)
		if (kind === "arc") {
			const second = await saveAsset(new Uint8Array([2]), "pdf")
			const questId = await seasons.addQuest(ids[0], ids[1], now)
			await seasons.setQuestAsset(ids[0], ids[1], questId, second)
		}
		expect(await (kind === "quest" ? removeQuest(...ids) : removeArc(ids[0], ids[1]))).toEqual({ ok: true })
		expect(await readdir(directory)).toEqual([path.basename(first)])
		expect(await removeQuest(other._id, ids[1], ids[2])).toEqual({ ok: true })
		expect(await readdir(directory)).toEqual([])
	})
})

describe.each(actions)("$name", ({ name, run, count }) => {
	it.each([{}, { kind: "team", id: "team" }] as const)(
		"rejects session %j before validation or writes",
		async (session) => {
			const season = await setup()
			vi.mocked(getSession).mockResolvedValueOnce(session as Awaited<ReturnType<typeof getSession>>)
			const write = vi.spyOn(seasons, name)
			await expect(run(["", "", ""])).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") })
			expect(write).not.toHaveBeenCalled()
			expect(await seasons.getSeason(season._id)).toEqual(season)
			expect(publish).not.toHaveBeenCalled()
			expect(refresh).not.toHaveBeenCalled()
		},
	)

	it.each([null, new Date(now.getTime() + 60_000)])(
		"writes before start %j and publishes both channels once",
		async (start) => {
			await setup(start)
			const write = vi.spyOn(seasons, name)
			const result = await run([...ids])
			expect(write).toHaveBeenCalledWith(...ids.slice(0, count), now)
			const season = await seasons.getSeason(ids[0])
			if (name === "addArc") {
				expect(result).toEqual({ ok: true, arcId: season?.arcs[1]?.id })
				expect(season?.arcs).toHaveLength(2)
			} else if (name === "addQuest") {
				expect(result).toEqual({ ok: true, questId: season?.arcs[0]?.quests[1]?.id })
				expect(season?.arcs[0]?.quests).toHaveLength(2)
			} else {
				expect(result).toEqual({ ok: true })
				expect(name === "removeArc" ? season?.arcs : season?.arcs[0]?.quests).toEqual([])
			}
			expect(vi.mocked(publish).mock.calls).toEqual([[seasonChannel(ids[0])], [boardChannel]])
			if (name === "addQuest") expect(refresh).toHaveBeenCalledExactlyOnceWith()
			else expect(refresh).not.toHaveBeenCalled()
		},
	)

	it.each([now, new Date(now.getTime() - 3_600_000)])("rejects started season %j without publishing", async (start) => {
		const season = await setup(start)
		expect(await run([...ids])).toEqual({ ok: false, error: "The game has started." })
		expect(await seasons.getSeason(ids[0])).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
		expect(refresh).not.toHaveBeenCalled()
	})

	it("validates every id before writing", async () => {
		const season = await setup()
		const write = vi.spyOn(seasons, name)
		for (let index = 0; index < count; index++) {
			for (const invalid of ["", null, 42]) {
				const invalidIds: Ids = [...ids]
				invalidIds[index] = invalid as string
				expect(await run(invalidIds)).toEqual({ ok: false, error: "Invalid value." })
			}
		}
		expect(write).not.toHaveBeenCalled()
		expect(await seasons.getSeason(ids[0])).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
		expect(refresh).not.toHaveBeenCalled()
	})

	it("rethrows unexpected write failures without publishing", async () => {
		const error = new Error("Database unavailable")
		vi.spyOn(seasons, name).mockRejectedValueOnce(error)
		await expect(run([...ids])).rejects.toBe(error)
		expect(publish).not.toHaveBeenCalled()
		expect(refresh).not.toHaveBeenCalled()
	})
})
