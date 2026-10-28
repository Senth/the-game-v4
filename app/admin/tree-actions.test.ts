import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { refresh } from "next/cache"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { saveAsset } from "@/lib/assets/files"
import * as assets from "@/lib/assets/release"
import { getSession } from "@/lib/auth/session"
import { collections } from "@/lib/db/collections"
import * as seasons from "@/lib/db/seasons"
import { createTeam, getTeam, listTeams, setTeamField } from "@/lib/db/teams"
import type { Team } from "@/lib/domain/schemas"
import { newArc, newQuest } from "@/lib/domain/season-tree"
import { boardChannel, publish, seasonChannel, teamChannel } from "@/lib/events/bus"
import { submitAnswer } from "@/lib/game/game"
import { useTestDb } from "@/test/db"
import {
	addArc,
	addQuest,
	addQuestToGame,
	getAddQuestImpact,
	getRemoveArcImpact,
	getRemoveQuestImpact,
	moveArc,
	moveQuest,
	removeArc,
	removeQuest,
} from "./tree-actions"

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }))
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }))
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
	await db.teams.deleteMany({})
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
		await mkdir(path.resolve(".tmp"), { recursive: true })
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

	it("rejects ended seasons without publishing", async () => {
		const start = new Date(now.getTime() - 3_600_000)
		const season = await setup(start)
		expect(await run([...ids])).toEqual({ ok: false, error: "The game has ended." })
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

it("creates quests with season defaults, including hidden live drafts", async () => {
	for (const start of [null, now]) {
		await setup(start)
		await seasons.setSeasonField(ids[0], { field: "defaultQuestPoints" }, 30)
		const result = await addQuest(ids[0], ids[1])
		expect(result.ok).toBe(true)
		if (!result.ok) throw new Error(result.error)
		const quest = (await seasons.getSeason(ids[0]))?.arcs[0]?.quests.at(-1)
		expect(quest).toMatchObject({ id: result.questId, points: 30 })
		if (start) expect(quest?.hidden).toBe(true)
		else expect(quest?.hidden).toBeUndefined()
		await (await collections()).seasons.deleteMany({})
	}
})

it("creates quests without points for a legacy season missing the default", async () => {
	await setup()
	await (await collections()).seasons.updateOne({ _id: ids[0] }, { $unset: { defaultQuestPoints: "" } })
	const result = await addQuest(ids[0], ids[1])
	expect(result.ok).toBe(true)
	expect((await seasons.getSeason(ids[0]))?.arcs[0]?.quests.at(-1)?.points).toBeNull()
})

describe("live structural actions", () => {
	async function playing(name: string, overrides: Partial<Team> = {}) {
		return createTeam({
			name,
			passwordHash: "hash",
			seasonId: ids[0],
			questOrder: [ids[2], "next"],
			questIndex: 0,
			score: 0,
			completed: false,
			progress: [],
			...overrides,
		})
	}

	it.each(["content", "asset"])(
		"publishes a ready %s-only draft once after each built, unfinished team's current quest",
		async (source) => {
			await setup(now)
			await seasons.setSeasonField(ids[0], { arcId: ids[1], questId: ids[2], field: "hidden" }, true)
			const active = await playing("Active", { questOrder: ["current", "next"] })
			const finished = await playing("Finished", { questOrder: ["current"], questIndex: 1, completed: true })
			const unbuilt = await playing("Unbuilt", { questOrder: [] })
			const other = await playing("Other", { seasonId: "other" })
			expect(await getAddQuestImpact(...ids)).toEqual({
				ok: true,
				impact: { kind: "addQuest", added: ["Active"], completed: 1 },
			})
			expect(await addQuestToGame(...ids)).toEqual({
				ok: false,
				error: "Fill in content, answers and points first.",
			})
			expect(publish).not.toHaveBeenCalled()
			for (const [field, value] of [
				["content", source === "content" ? "Find the light" : ""],
				["answers", ["lamp"]],
				["points", 0],
			] as const) {
				await seasons.setSeasonField(ids[0], { arcId: ids[1], questId: ids[2], field }, value)
			}
			if (source === "asset") await seasons.setQuestAsset(...ids, "/assets/clue.png")
			expect(await addQuestToGame(...ids)).toEqual({ ok: true })
			const order = (await getTeam(active._id))?.questOrder ?? []
			expect(order[0]).toBe("current")
			expect(order.slice(1).toSorted()).toEqual(["next", ids[2]].toSorted())
			for (const team of [finished, unbuilt, other]) expect(await getTeam(team._id)).toEqual(team)
			expect((await seasons.getSeason(ids[0]))?.arcs[0]?.quests[0]?.hidden).toBe(false)
			expect(vi.mocked(publish).mock.calls).toEqual([
				[teamChannel(active._id)],
				[seasonChannel(ids[0])],
				[boardChannel],
			])
			expect(await addQuestToGame(...ids)).toEqual({ ok: true })
			expect((await getTeam(active._id))?.questOrder).toEqual(order)
		},
	)

	it("counts each arc-removal team once and removes all remaining visible quests", async () => {
		await setup(now)
		const { seasons: documents } = await collections()
		await documents.updateOne({ _id: ids[0] }, { $push: { "arcs.0.quests": { ...newQuest(), id: "second" } } })
		const onIt = await playing("On both", { questOrder: [ids[2], "second"] })
		const future = await playing("Both left", { questOrder: ["current", "second", ids[2]] })
		const solved = await playing("Solved both", {
			questOrder: [ids[2], "second"],
			questIndex: 2,
			completed: true,
			score: 40,
		})
		await playing("Unbuilt", { questOrder: [] })
		expect(await getRemoveArcImpact(ids[0], ids[1])).toEqual({
			ok: true,
			impact: { kind: "deleteQuest", onIt: ["On both"], notReached: ["Both left"], solved: 1 },
		})
		expect(await getRemoveQuestImpact(...ids)).toEqual({
			ok: true,
			impact: { kind: "deleteQuest", onIt: ["On both"], notReached: ["Both left"], solved: 1 },
		})
		expect(publish).not.toHaveBeenCalled()
		expect(await removeArc(ids[0], ids[1])).toEqual({ ok: true })
		expect(await getTeam(onIt._id)).toMatchObject({
			questOrder: [],
			questIndex: 0,
			completed: true,
			score: 0,
			progress: [{ questId: ids[2], hintsRevealed: [], pointsEarned: 0 }],
		})
		expect(await getTeam(future._id)).toEqual({ ...future, questOrder: ["current"] })
		expect(await getTeam(solved._id)).toEqual(solved)
		expect(vi.mocked(publish).mock.calls).toEqual([
			[teamChannel(onIt._id)],
			[teamChannel(future._id)],
			[seasonChannel(ids[0])],
			[boardChannel],
		])
	})

	it.each(["quest", "arc"])("counts no team for hidden-only %s removal", async (kind) => {
		await setup(now)
		await seasons.setSeasonField(ids[0], { arcId: ids[1], questId: ids[2], field: "hidden" }, true)
		await playing("Active")
		expect(await (kind === "quest" ? getRemoveQuestImpact(...ids) : getRemoveArcImpact(ids[0], ids[1]))).toEqual({
			ok: true,
			impact: { kind: "deleteQuest", onIt: [], notReached: [], solved: 0 },
		})
	})

	it.each([
		{ name: "addQuestToGame", run: (input: Ids) => addQuestToGame(...input), count: 3 },
		{ name: "getAddQuestImpact", run: (input: Ids) => getAddQuestImpact(...input), count: 3 },
		{ name: "getRemoveQuestImpact", run: (input: Ids) => getRemoveQuestImpact(...input), count: 3 },
		{ name: "getRemoveArcImpact", run: (input: Ids) => getRemoveArcImpact(input[0], input[1]), count: 2 },
	])("$name rejects non-admins and validates ids", async ({ run, count }) => {
		await setup(now)
		for (const session of [{}, { kind: "team", id: "team" }]) {
			vi.mocked(getSession).mockResolvedValueOnce(session as Awaited<ReturnType<typeof getSession>>)
			await expect(run(["", "", ""])).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") })
		}
		for (let index = 0; index < count; index++) {
			for (const invalid of ["", null, 42]) {
				const input: Ids = [...ids]
				input[index] = invalid as string
				expect(await run(input)).toEqual({ ok: false, error: "Invalid value." })
			}
		}
		expect(publish).not.toHaveBeenCalled()
	})

	it("keeps concurrent solve and remove consistent through the actions", async () => {
		await setup(now)
		await (await collections()).seasons.updateOne(
			{ _id: ids[0] },
			{ $push: { "arcs.0.quests": { ...newQuest(), id: "next" } } },
		)
		await seasons.setSeasonField(ids[0], { arcId: ids[1], questId: ids[2], field: "answers" }, ["lamp"])
		await seasons.setSeasonField(ids[0], { arcId: ids[1], questId: ids[2], field: "points" }, 20)
		const team = await playing("Ninjas")
		const [solve, remove] = await Promise.all([submitAnswer(team, ids[2], "lamp", now), removeQuest(...ids)])
		expect(remove).toEqual({ ok: true })
		const stored = await getTeam(team._id)
		if (solve.ok && solve.correct) {
			expect(stored).toEqual({
				...team,
				questIndex: 1,
				reachedAt: now,
				score: 20,
				progress: [{ questId: ids[2], solvedAt: now, pointsEarned: 20, hintsRevealed: [] }],
			})
		} else {
			expect(solve).toEqual({ ok: false, reason: "stale" })
			expect(stored).toEqual({
				...team,
				questOrder: ["next"],
				reachedAt: now,
				progress: [{ questId: ids[2], hintsRevealed: [], pointsEarned: 0 }],
			})
		}
	})

	it("rejects Add to game and moves after end", async () => {
		await setup(new Date(now.getTime() - 3_600_000))
		expect(await addQuestToGame(...ids)).toEqual({ ok: false, error: "The game has ended." })
		expect(await moveArc({ seasonId: ids[0], id: ids[1], beforeId: null })).toEqual({
			ok: false,
			error: "The game has ended.",
		})
		expect(await moveQuest({ seasonId: ids[0], id: ids[2], toArcId: ids[1], beforeId: null })).toEqual({
			ok: false,
			error: "The game has ended.",
		})
		expect(publish).not.toHaveBeenCalled()
	})

	it("adds hidden drafts and empty arcs without changing teams", async () => {
		await setup(now)
		const team = await playing("Ninjas")
		const result = await addQuest(ids[0], ids[1])
		expect(result.ok).toBe(true)
		if (!result.ok) throw new Error(result.error)
		expect((await seasons.getSeason(ids[0]))?.arcs[0]?.quests.at(-1)).toMatchObject({
			id: result.questId,
			hidden: true,
		})
		expect(await addArc(ids[0])).toMatchObject({ ok: true })
		expect(await getTeam(team._id)).toEqual(team)
		expect(vi.mocked(publish).mock.calls).toEqual([
			[seasonChannel(ids[0])],
			[boardChannel],
			[seasonChannel(ids[0])],
			[boardChannel],
		])
	})

	it.each(["quest", "arc"])(
		"removes live %s from current and unreached teams, retaining solved history",
		async (kind) => {
			await setup(now)
			const snapshot = { hintId: "old-hint", text: "Original", points: 5, revealedAt: now }
			const onIt = await playing("On it", {
				progress: [{ questId: ids[2], hintsRevealed: [snapshot], pointsEarned: 0 }],
			})
			const future = await playing("Not reached", { questOrder: ["next", ids[2]] })
			const solved = await playing("Solved", {
				questIndex: 1,
				score: 15,
				progress: [{ questId: ids[2], solvedAt: now, hintsRevealed: [snapshot], pointsEarned: 15 }],
			})
			const unbuilt = await playing("Unbuilt", { questOrder: [] })
			const other = await playing("Other season", { seasonId: "other" })
			expect(await (kind === "quest" ? removeQuest(...ids) : removeArc(ids[0], ids[1]))).toEqual({ ok: true })
			expect(await getTeam(onIt._id)).toEqual({ ...onIt, questOrder: ["next"], reachedAt: now })
			expect(await getTeam(future._id)).toEqual({ ...future, questOrder: ["next"] })
			for (const team of [solved, unbuilt, other]) expect(await getTeam(team._id)).toEqual(team)
			expect(vi.mocked(publish).mock.calls).toEqual([
				[teamChannel(onIt._id)],
				[teamChannel(future._id)],
				[seasonChannel(ids[0])],
				[boardChannel],
			])
		},
	)

	it("removing a hidden draft leaves all teams untouched", async () => {
		await setup(now)
		await seasons.setSeasonField(ids[0], { arcId: ids[1], questId: ids[2], field: "hidden" }, true)
		const team = await playing("Ninjas")
		expect(await removeQuest(...ids)).toEqual({ ok: true })
		expect(await listTeams(ids[0])).toEqual([team])
		expect(vi.mocked(publish).mock.calls).toEqual([[seasonChannel(ids[0])], [boardChannel]])
	})

	it("recomputes removal from current team documents, not an earlier dialog snapshot", async () => {
		await setup(now)
		const team = await playing("Ninjas")
		expect(await getRemoveQuestImpact(...ids)).toEqual({
			ok: true,
			impact: { kind: "deleteQuest", onIt: ["Ninjas"], notReached: [], solved: 0 },
		})
		await setTeamField(team._id, "questIndex", 1)
		await setTeamField(team._id, "score", 20)
		const before = await getTeam(team._id)
		expect(await removeQuest(...ids)).toEqual({ ok: true })
		expect(await getTeam(team._id)).toEqual(before)
		expect(vi.mocked(publish).mock.calls).toEqual([[seasonChannel(ids[0])], [boardChannel]])
	})
})
