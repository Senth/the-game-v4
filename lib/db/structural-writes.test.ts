import { Collection } from "mongodb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	addQuestToGame as addQuestAction,
	removeArc as removeArcAction,
	removeQuest as removeQuestAction,
} from "@/app/admin/tree-actions"
import { releaseAsset } from "@/lib/assets/release"
import { newArc, newQuest } from "@/lib/domain/season-tree"
import { publish } from "@/lib/events/bus"
import { loadGame, submitAnswer } from "@/lib/game/game"
import { useTestDb } from "@/test/db"
import { collections } from "./collections"
import { addQuestToGame, createSeason, getSeason, removeArc, removeQuest } from "./seasons"
import { createTeam, fillQuestOrders, getTeam } from "./teams"

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn() }))
vi.mock("next/cache", () => ({ refresh: vi.fn() }))
vi.mock("@/lib/assets/release", () => ({ releaseAsset: vi.fn() }))
vi.mock("@/lib/events/bus", async (original) => ({
	...(await original<typeof import("@/lib/events/bus")>()),
	publish: vi.fn(),
}))

useTestDb()
const now = new Date("2026-10-24T17:00:00Z")

beforeEach(() => {
	vi.restoreAllMocks()
	vi.mocked(publish).mockClear()
	vi.mocked(releaseAsset).mockReset().mockResolvedValue(undefined)
	vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())

async function setup(hidden = false) {
	return createSeason({
		title: "Structural races",
		lengthMinutes: 60,
		start: now,
		end: new Date(now.getTime() + 3_600_000),
		shuffleArcs: false,
		arcs: ["q1", "q2", "q3"].map((id, index) => ({
			...newArc(false),
			id: `a${index + 1}`,
			quests: [
				{
					...newQuest(),
					id,
					displayTitle: id,
					content: id,
					answers: [id],
					points: 10,
					...(id === "q2" ? { hidden, assetPath: "/assets/removed.png" } : {}),
				},
			],
		})),
	})
}

async function playing(seasonId: string, name: string, questOrder: string[]) {
	return createTeam({
		name,
		passwordHash: "hash",
		seasonId,
		questOrder,
		questIndex: 0,
		score: 0,
		completed: false,
		progress: [],
	})
}

describe("resumable structural propagation", () => {
	it.each(["addQuestToGame", "removeQuest", "removeArc"] as const)(
		"retries %s after four CAS conflicts, publishing every committed write",
		async (kind) => {
			const season = await setup(kind === "addQuestToGame")
			const order = kind === "addQuestToGame" ? ["q1", "q3"] : ["q2", "q3"]
			const first = await playing(season._id, "First", order)
			const second = await playing(season._id, "Second", order)
			const original = Collection.prototype.updateOne
			let conflicts = 0
			const write = vi.spyOn(Collection.prototype, "updateOne").mockImplementation(async function (
				this: Collection,
				...args
			) {
				if (this.collectionName === "teams" && args[0]._id === second._id && conflicts++ < 4) {
					return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null }
				}
				return original.apply(this, args)
			})
			const run = () =>
				kind === "removeArc"
					? removeArcAction(season._id, "a2")
					: kind === "removeQuest"
						? removeQuestAction(season._id, "a2", "q2")
						: addQuestAction(season._id, "a2", "q2")
			expect(await run()).toEqual({ ok: false, error: "Not saved, retry" })
			expect((await (await collections()).seasons.findOne({ _id: season._id }))?.pendingStructure).toBeDefined()
			expect(await getTeam(second._id)).toEqual(second)
			const committed = await getTeam(first._id)
			expect(committed?.questOrder).not.toEqual(order)
			expect(vi.mocked(publish).mock.calls).toEqual([[`team:${first._id}`], [`season:${season._id}`], ["board"]])
			write.mockRestore()
			expect(await run()).toEqual({ ok: true })
			expect((await (await collections()).seasons.findOne({ _id: season._id }))?.pendingStructure).toBeUndefined()
			expect(await getTeam(first._id)).toEqual(committed)
			const stored = await getTeam(second._id)
			if (kind === "addQuestToGame") {
				expect(stored?.questOrder[0]).toBe("q1")
				expect(stored?.questOrder.toSorted()).toEqual(["q1", "q2", "q3"])
			} else {
				expect(stored).toMatchObject({
					questOrder: ["q3"],
					questIndex: 0,
					score: 0,
					progress: [{ questId: "q2", hintsRevealed: [], pointsEarned: 0 }],
				})
				expect(releaseAsset).toHaveBeenCalledExactlyOnceWith("/assets/removed.png")
			}
			expect(vi.mocked(publish).mock.calls.slice(3)).toEqual([
				[`team:${second._id}`],
				[`season:${season._id}`],
				["board"],
			])
		},
	)

	it.each(["removeQuest", "removeArc"] as const)("recovers failed %s before a later order build", async (kind) => {
		const season = await setup()
		const team = await playing(season._id, "Playing", ["q2", "q3"])
		const unbuilt = await playing(season._id, "Unbuilt", [])
		const original = Collection.prototype.updateOne
		const write = vi.spyOn(Collection.prototype, "updateOne").mockImplementation(async function (
			this: Collection,
			...args
		) {
			if (this.collectionName === "teams") throw new Error("Propagation unavailable")
			return original.apply(this, args)
		})
		await expect(
			kind === "removeQuest" ? removeQuest(season._id, "a2", "q2", now) : removeArc(season._id, "a2", now),
		).rejects.toThrow("Propagation unavailable")
		write.mockRestore()
		expect(await fillQuestOrders(season, [unbuilt])).toBe(true)
		expect((await getTeam(team._id))?.questOrder).toEqual(["q3"])
		expect((await getTeam(unbuilt._id))?.questOrder).toEqual(["q1", "q3"])
		expect(releaseAsset).toHaveBeenCalledExactlyOnceWith("/assets/removed.png")
	})
})

describe("serialized structural writes", () => {
	it.each(["removeQuest", "removeArc"] as const)(
		"queues %s between visibility change and team insertion",
		async (kind) => {
			const season = await setup(true)
			const team = await playing(season._id, "Playing", ["q1", "q3"])
			const inserting = Promise.withResolvers<void>()
			const release = Promise.withResolvers<void>()
			const removed = Promise.withResolvers<void>()
			const original = Collection.prototype.updateOne
			vi.spyOn(Collection.prototype, "updateOne").mockImplementation(async function (this: Collection, ...args) {
				if (this.collectionName === "teams") {
					inserting.resolve()
					await release.promise
				}
				return original.apply(this, args)
			})
			const adding = addQuestToGame(season._id, "a2", "q2", now)
			await inserting.promise
			expect((await getSeason(season._id))?.arcs[1]?.quests[0]?.hidden).toBe(false)
			const removing = (
				kind === "removeQuest" ? removeQuest(season._id, "a2", "q2", now) : removeArc(season._id, "a2", now)
			).then((result) => {
				removed.resolve()
				return result
			})
			await Promise.race([removed.promise, new Promise((resolve) => setTimeout(resolve, 100))])
			release.resolve()
			await Promise.all([adding, removing])
			expect((await getTeam(team._id))?.questOrder).toEqual(["q1", "q3"])
		},
	)

	it("prevents a paused pre-removal order build from committing deleted quests", async () => {
		const season = await setup()
		const team = await playing(season._id, "Unbuilt", [])
		const building = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const removed = Promise.withResolvers<void>()
		const original = Collection.prototype.bulkWrite
		vi.spyOn(Collection.prototype, "bulkWrite").mockImplementation(async function (this: Collection, ...args) {
			building.resolve()
			await release.promise
			return original.apply(this, args)
		})
		const filling = fillQuestOrders(season, [team])
		await building.promise
		const removing = removeQuest(season._id, "a1", "q1", now).then((result) => {
			removed.resolve()
			return result
		})
		await Promise.race([removed.promise, new Promise((resolve) => setTimeout(resolve, 100))])
		release.resolve()
		await Promise.all([filling, removing])
		const stored = await getTeam(team._id)
		expect(stored?.questOrder).toEqual(["q2", "q3"])
		if (!stored) throw new Error("fixture")
		expect(await loadGame(stored, now)).toMatchObject({ lifecycleState: "running", quest: { id: "q2" } })
		expect(await submitAnswer(stored, "q2", "q2", now)).toMatchObject({ ok: true, correct: true })
	})

	it("re-reads the season when an old snapshot reaches order construction after removal", async () => {
		const season = await setup()
		const team = await playing(season._id, "Unbuilt", [])
		await removeQuest(season._id, "a1", "q1", now)
		expect(await fillQuestOrders(season, [team])).toBe(true)
		expect((await getTeam(team._id))?.questOrder).toEqual(["q2", "q3"])
	})
})
