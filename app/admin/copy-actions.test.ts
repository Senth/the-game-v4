import { mkdtemp, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { saveAsset } from "@/lib/assets/files"
import { getSession } from "@/lib/auth/session"
import { collections } from "@/lib/db/collections"
import * as seasons from "@/lib/db/seasons"
import { createTeam, listTeams } from "@/lib/db/teams"
import { copyDestinations } from "@/lib/domain/copy"
import { newArc, newQuest } from "@/lib/domain/season-tree"
import { publish, seasonChannel } from "@/lib/events/bus"
import { useTestDb } from "@/test/db"
import { removeQuestAsset } from "./asset-actions"
import { saveSeasonField } from "./autosave-actions"
import { copyArc, copyQuest, getCopyDestinations } from "./copy-actions"

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }))
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
	const db = await collections()
	await db.seasons.deleteMany({})
	await db.teams.deleteMany({})
	await db.admins.deleteMany({})
	await db.admins.insertOne({ _id: "admin", name: "admin", passwordHash: "hash" })
	vi.mocked(getSession)
		.mockReset()
		.mockResolvedValue({ kind: "admin", id: "admin" } as Awaited<ReturnType<typeof getSession>>)
	vi.mocked(publish).mockClear()
})

afterEach(() => vi.useRealTimers())

async function setup(id: string, start: Date | null = null) {
	return seasons.createSeason({
		_id: id,
		title: id,
		lengthMinutes: 60,
		start,
		end: start ? new Date(start.getTime() + 3_600_000) : null,
		shuffleArcs: false,
		arcs: [
			{
				...newArc(true),
				id: "arc",
				title: "Lighthouse",
				quests: [
					{
						...newQuest(),
						id: "quest",
						displayTitle: "Beacon",
						internalTitle: "Lamp",
						content: "Find the light",
						answers: ["lamp"],
						points: 20,
						adminNotes: "Keep this",
						hints: [{ id: "hint", text: "Look up", points: 5 }],
					},
				],
			},
		],
	})
}

it("lists only other unstarted seasons without changing documents or publishing", async () => {
	const documents = await Promise.all([
		setup("source"),
		setup("later", at(10)),
		setup("soon", at(1)),
		setup("waiting"),
		setup("live", now),
		setup("ended", at(-60)),
	])
	expect(await getCopyDestinations("source")).toEqual({
		ok: true,
		destinations: copyDestinations(documents, "source", now),
	})
	expect(await seasons.listSeasons()).toEqual(expect.arrayContaining(documents))
	expect(publish).not.toHaveBeenCalled()
})

describe.each(["arc", "quest"] as const)("copy %s", (kind) => {
	const run = (source = "source", item: string = kind, destination = "destination") =>
		kind === "arc"
			? copyArc(source, item, destination)
			: copyQuest(source, item, { seasonId: destination, arcId: "arc" })

	it.each([null, at(10), now, at(-60)])(
		"copies current source fields with start=%s last, without changing teams",
		async (start) => {
			await setup("source", start)
			const destination = await setup("destination", at(30))
			await seasons.setSeasonField("source", { arcId: "arc", questId: "quest", field: "hidden" }, true)
			await seasons.setSeasonField("source", { arcId: "arc", questId: "quest", field: "content" }, "Latest content")
			const source = await seasons.getSeason("source")
			const team = await createTeam({
				name: "Ninjas",
				passwordHash: "hash",
				seasonId: "source",
				questOrder: ["quest"],
				questIndex: 0,
				score: 0,
				completed: false,
				progress: [],
			})
			const result = await run()
			expect(result.ok).toBe(true)
			if (!result.ok) throw new Error(result.error)
			const stored = await seasons.getSeason("destination")
			const arc = kind === "arc" ? stored?.arcs.at(-1) : stored?.arcs[0]
			const quest = arc?.quests.at(-1)
			expect(result).toEqual({
				ok: true,
				seasonId: "destination",
				arcId: arc?.id,
				...(kind === "quest" ? { questId: quest?.id } : {}),
			})
			expect(arc?.title).toBe("Lighthouse")
			expect(arc?.shuffleQuests).toBe(true)
			if (kind === "arc") {
				expect(stored?.arcs.slice(0, -1)).toEqual(destination.arcs)
				expect(arc?.id).not.toBe("arc")
			} else expect(arc?.quests.slice(0, -1)).toEqual(destination.arcs[0]?.quests)
			expect(quest).toEqual({
				...source?.arcs[0]?.quests[0],
				id: expect.any(String),
				hints: [{ id: expect.any(String), text: "Look up", points: 5 }],
				hidden: undefined,
			})
			expect(quest).not.toHaveProperty("hidden")
			expect(quest?.id).not.toBe("quest")
			expect(quest?.hints[0]?.id).not.toBe("hint")
			expect(await seasons.getSeason("source")).toEqual(source)
			expect(await listTeams("source")).toEqual([team])
			expect(await listTeams("destination")).toEqual([])
			expect(vi.mocked(publish).mock.calls).toEqual([[seasonChannel("destination")]])
		},
	)

	it.each([now, at(-60)])("rejects started destinations with start=%s and same-season copies", async (start) => {
		const source = await setup("source")
		const destination = await setup("destination", start)
		expect(await run()).toEqual({ ok: false, error: "destination has started. Pick another season." })
		expect(await run("source", kind, "source")).toEqual({ ok: false, error: "Pick another season." })
		expect(await seasons.getSeason("source")).toEqual(source)
		expect(await seasons.getSeason("destination")).toEqual(destination)
		expect(publish).not.toHaveBeenCalled()
	})

	it("rejects missing source items and destinations without publishing", async () => {
		await setup("source")
		await setup("destination")
		for (const result of [await run("missing"), await run("source", "missing"), await run("source", kind, "missing")]) {
			expect(result).toMatchObject({ ok: false, error: expect.stringContaining("not found") })
		}
		expect(publish).not.toHaveBeenCalled()
	})

	it("validates ids and rethrows unexpected database failures", async () => {
		await setup("source")
		const write = vi.spyOn(seasons, kind === "arc" ? "copyArcToSeason" : "copyQuestToSeason")
		for (const args of [
			["", kind, "destination"],
			["source", "", "destination"],
			["source", kind, ""],
		]) {
			expect(await run(...(args as [string, string, string]))).toEqual({ ok: false, error: "Invalid value." })
		}
		expect(write).not.toHaveBeenCalled()
		const error = new Error("Database unavailable")
		write.mockRejectedValueOnce(error)
		await expect(run()).rejects.toBe(error)
		expect(publish).not.toHaveBeenCalled()
	})
})

it.each([false, true])("copies a quest into a new arc with source shuffleQuests=%s", async (shuffleQuests) => {
	await setup("source")
	await seasons.setSeasonField("source", { arcId: "arc", field: "shuffleQuests" }, shuffleQuests)
	const destination = await setup("destination")
	const result = await copyQuest("source", "quest", { seasonId: "destination", newArc: true })
	expect(result.ok).toBe(true)
	if (!result.ok) throw new Error(result.error)
	const stored = await seasons.getSeason("destination")
	expect(stored?.arcs.slice(0, -1)).toEqual(destination.arcs)
	expect(stored?.arcs.at(-1)).toMatchObject({
		id: result.arcId,
		title: "Lighthouse",
		shuffleQuests,
		quests: [{ id: result.questId }],
	})
	expect(result.arcId).not.toBe("arc")
	expect(result.questId).not.toBe("quest")
	expect(vi.mocked(publish).mock.calls).toEqual([[seasonChannel("destination")]])
})

it("rejects malformed quest targets and missing destination arcs", async () => {
	await setup("source")
	const destination = await setup("destination")
	for (const dest of [
		{ seasonId: "destination" },
		{ seasonId: "destination", newArc: false },
		{ seasonId: "destination", arcId: "arc", newArc: true },
		{ seasonId: "destination", arcId: "" },
	]) {
		expect(await copyQuest("source", "quest", dest as Parameters<typeof copyQuest>[2])).toEqual({
			ok: false,
			error: "Invalid value.",
		})
	}
	expect(await copyQuest("source", "quest", { seasonId: "destination", arcId: "missing" })).toEqual({
		ok: false,
		error: "Arc missing not found",
	})
	expect(await seasons.getSeason("destination")).toEqual(destination)
	expect(publish).not.toHaveBeenCalled()
})

it.each([{}, { kind: "team", id: "team" }])(
	"guards all copy actions before reads or validation for session %j",
	async (session) => {
		vi.mocked(getSession).mockResolvedValue(session as Awaited<ReturnType<typeof getSession>>)
		const read = vi.spyOn(seasons, "getSeason")
		const list = vi.spyOn(seasons, "listSeasons")
		for (const run of [
			() => getCopyDestinations(""),
			() => copyArc("", "", ""),
			() => copyQuest("", "", { seasonId: "", newArc: true }),
		]) {
			await expect(run()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") })
		}
		expect(read).not.toHaveBeenCalled()
		expect(list).not.toHaveBeenCalled()
		expect(publish).not.toHaveBeenCalled()
	},
)

it("autosaves copies independently and keeps shared image files when removing the copy's image", async () => {
	await setup("source")
	await setup("destination")
	const directory = await mkdtemp(path.resolve(".tmp", "copy-assets-"))
	vi.stubEnv("ASSETS_DIR", directory)
	try {
		const assetPath = await saveAsset(new Uint8Array([1]), "png")
		await seasons.setQuestAsset("source", "arc", "quest", assetPath)
		const source = await seasons.getSeason("source")
		const result = await copyQuest("source", "quest", { seasonId: "destination", arcId: "arc" })
		if (!result.ok) throw new Error(result.error)
		expect(
			await saveSeasonField(
				result.seasonId,
				{ arcId: result.arcId, questId: result.questId, field: "content" },
				"Changed copy",
			),
		).toEqual({ ok: true })
		expect(await removeQuestAsset(result.seasonId, result.arcId, result.questId)).toEqual({ ok: true })
		expect(await readdir(directory)).toEqual([path.basename(assetPath)])
		expect(await seasons.getSeason("source")).toEqual(source)
		expect((await seasons.getSeason("destination"))?.arcs[0]?.quests.at(-1)).toMatchObject({
			content: "Changed copy",
			assetPath: null,
		})
		expect(
			await saveSeasonField("source", { arcId: "arc", questId: "quest", field: "content" }, "Changed source"),
		).toEqual({ ok: true })
		expect((await seasons.getSeason("destination"))?.arcs[0]?.quests.at(-1)?.content).toBe("Changed copy")
	} finally {
		vi.unstubAllEnvs()
		await rm(directory, { recursive: true, force: true })
	}
})
