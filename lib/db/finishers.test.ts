import { Collection } from "mongodb"
import { describe, expect, it, vi } from "vitest"
import { newArc, newQuest } from "@/lib/domain/season-tree"
import { loadGame, submitAnswer } from "@/lib/game/game"
import { useTestDb } from "@/test/db"
import { collections } from "./collections"
import { claimFinish } from "./finishers"
import { createSeason, getSeason, removeQuest, setSeasonField } from "./seasons"
import { createTeam, deleteTeam, getTeam } from "./teams"

useTestDb()
const now = new Date("2026-10-20T18:10:00Z")

async function setup(bonuses: number[] = [50, 20]) {
	return createSeason({
		title: "Finishers",
		lengthMinutes: 60,
		start: new Date(now.getTime() - 600_000),
		end: new Date(now.getTime() + 600_000),
		shuffleArcs: false,
		finisherBonuses: bonuses,
		arcs: [{ ...newArc(false), id: "arc", quests: [{ ...newQuest(), id: "last", answers: ["answer"], points: 10 }] }],
	})
}

async function playing(seasonId: string, reachedAt = now) {
	return createTeam({
		name: crypto.randomUUID(),
		passwordHash: "hash",
		seasonId,
		questOrder: ["last"],
		questIndex: 0,
		score: 7,
		completed: false,
		progress: [],
		reachedAt,
	})
}

describe("claimFinish", () => {
	it("gives five concurrent final solves unique places and exactly their frozen points", async () => {
		const season = await setup([50, 40, 30, 20, 10])
		const teams = await Promise.all(Array.from({ length: 5 }, () => playing(season._id)))
		const results = await Promise.all(teams.map((team) => submitAnswer(team, "last", "answer", now)))
		for (const result of results)
			expect(result).toMatchObject({ ok: true, correct: true, game: { lifecycleState: "completed" } })
		const finishers = (await getSeason(season._id))?.finishers ?? []
		expect(finishers.map(({ place }) => place).toSorted()).toEqual([1, 2, 3, 4, 5])
		expect(new Set(finishers.map(({ teamId }) => teamId)).size).toBe(5)
		for (const entry of finishers) {
			expect(entry.points).toBe(season.finisherBonuses[entry.place - 1])
			expect(await getTeam(entry.teamId)).toMatchObject({ score: 17 + entry.points, completed: true, reachedAt: now })
		}
	})
	it("freezes awards across row edits and concurrent retries", async () => {
		const season = await setup()
		const team = await playing(season._id)
		const first = await claimFinish(season._id, team._id, now)
		await setSeasonField(season._id, { field: "finisherBonuses" }, [999, 20])
		const retried = await Promise.all(Array.from({ length: 5 }, () => claimFinish(season._id, team._id, new Date())))
		expect(retried).toEqual(Array(5).fill(first))
		expect(await getTeam(team._id)).toMatchObject({ score: 57 })
		expect((await getSeason(season._id))?.finishers).toEqual([first])
	})
	it("records zero-point finishes with no rows, including missing legacy fields", async () => {
		const season = await setup([])
		await (await collections()).seasons.updateOne(
			{ _id: season._id },
			{ $unset: { finisherBonuses: "", finishers: "" } },
		)
		const team = await playing(season._id)
		expect(await claimFinish(season._id, team._id, now)).toEqual({ teamId: team._id, place: 1, points: 0, at: now })
		expect(await getTeam(team._id)).toMatchObject({ score: 7 })
	})
	it("retries an interrupted score award without claiming another place or paying twice", async () => {
		const season = await setup()
		const team = await playing(season._id)
		const write = vi.spyOn(Collection.prototype, "updateOne").mockRejectedValueOnce(new Error("Award interrupted"))
		await expect(claimFinish(season._id, team._id, now)).rejects.toThrow("Award interrupted")
		write.mockRestore()
		await claimFinish(season._id, team._id, now)
		await claimFinish(season._id, team._id, now)
		expect(await getTeam(team._id)).toMatchObject({ score: 57 })
		expect((await getSeason(season._id))?.finishers).toHaveLength(1)
	})
	it("preserves a deleted winner's place", async () => {
		const season = await setup()
		const first = await playing(season._id)
		const second = await playing(season._id)
		const entry = await claimFinish(season._id, first._id, now)
		await deleteTeam(first._id)
		expect(await claimFinish(season._id, second._id, now)).toMatchObject({ place: 2, points: 20 })
		expect((await getSeason(season._id))?.finishers?.[0]).toEqual(entry)
	})
	it("repairs an interrupted final-solve award on the next game load", async () => {
		const season = await setup()
		const team = await playing(season._id)
		const original = Collection.prototype.updateOne
		const write = vi.spyOn(Collection.prototype, "updateOne").mockImplementation(async function (
			this: Collection,
			...args
		) {
			if (args[1] && "$set" in args[1] && args[1].$set?.finisherBonusApplied) throw new Error("Award interrupted")
			return original.apply(this, args)
		})
		await expect(submitAnswer(team, "last", "answer", now)).rejects.toThrow("Award interrupted")
		write.mockRestore()
		expect(await loadGame(team, now)).toMatchObject({ lifecycleState: "completed", score: 67 })
		expect(await loadGame(team, now)).toMatchObject({ lifecycleState: "completed", score: 67 })
		expect((await getSeason(season._id))?.finishers).toHaveLength(1)
	})
	it.each([false, true])("claims removal completions in arrival order, read repair=%s", async (repair) => {
		const season = await setup()
		const later = await playing(season._id, now)
		const earlier = await playing(season._id, new Date(now.getTime() - 60_000))
		if (repair) {
			await (await collections()).seasons.updateOne({ _id: season._id }, { $set: { arcs: [] } })
			await loadGame(later, now)
		} else await removeQuest(season._id, "arc", "last", now)
		expect((await getSeason(season._id))?.finishers?.map(({ teamId }) => teamId)).toEqual([earlier._id, later._id])
		expect(await getTeam(earlier._id)).toMatchObject({ completed: true, score: 57 })
		expect(await getTeam(later._id)).toMatchObject({ completed: true, score: 27 })
	})

	it("does not let a game load claim ahead of an in-flight removal batch", async () => {
		const season = await setup()
		const later = await playing(season._id, now)
		const earlier = await playing(season._id, new Date(now.getTime() - 60_000))
		const paused = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const original = Collection.prototype.updateOne
		const write = vi.spyOn(Collection.prototype, "updateOne").mockImplementation(async function (
			this: Collection,
			...args
		) {
			const result = await original.apply(this, args)
			if (
				this.collectionName === "teams" &&
				args[0]._id === later._id &&
				"$set" in args[1] &&
				args[1].$set?.completed
			) {
				paused.resolve()
				await release.promise
			}
			return result
		})
		const removing = removeQuest(season._id, "arc", "last", now)
		await paused.promise
		const loading = loadGame(later, now)
		await new Promise((resolve) => setTimeout(resolve, 50))
		release.resolve()
		try {
			await Promise.all([removing, loading])
			expect((await getSeason(season._id))?.finishers.map(({ teamId }) => teamId)).toEqual([earlier._id, later._id])
		} finally {
			write.mockRestore()
		}
	})
})
