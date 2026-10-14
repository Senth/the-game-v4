import { Collection } from "mongodb"
import { describe, expect, it, vi } from "vitest"
import type { SeasonInput } from "@/lib/domain/schemas"
import { newArc, newQuest } from "@/lib/domain/season-tree"
import { useTestDb } from "@/test/db"
import { NotFoundError } from "./collections"
import {
	addArc,
	addQuest,
	createSeason,
	getSeason,
	removeArc,
	removeQuest,
	SeasonStartedError,
	setQuestAsset,
	setSeasonField,
} from "./seasons"

useTestDb()

const now = new Date("2026-10-24T17:00:00Z")
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000)

function seasonInput(): Omit<SeasonInput, "_id" | "registrationOpen"> {
	return {
		title: "Cipher Night",
		lengthMinutes: 60,
		start: null,
		end: null,
		shuffleArcs: false,
		arcs: [
			{ ...newArc(false), id: "a1", quests: ["q1", "q2", "q3"].map((id) => ({ ...newQuest(), id })) },
			{ ...newArc(true), id: "a2", quests: [{ ...newQuest(), id: "q4" }] },
			{ ...newArc(false), id: "a3" },
		],
	}
}

const writes = [
	{ name: "addArc", run: (id: string) => addArc(id, now) },
	{ name: "addQuest", run: (id: string) => addQuest(id, "a1", now) },
	{ name: "removeArc", run: (id: string) => removeArc(id, "a2", now) },
	{ name: "removeQuest", run: (id: string) => removeQuest(id, "a1", "q2", now) },
]

describe("season tree writes", () => {
	it.each([
		{ state: "unscheduled", start: null, end: null },
		{ state: "upcoming", start: at(1), end: at(61) },
	])("adds and removes arcs and quests while $state, keeping siblings in order", async ({ start, end }) => {
		const season = await createSeason({ ...seasonInput(), start, end })
		const arcId = await addArc(season._id, now)
		const questId = await addQuest(season._id, "a1", now)
		const expected = structuredClone(season)
		expected.arcs.push({ id: arcId, title: "New arc", shuffleQuests: false, quests: [] })
		const arc = expected.arcs[0]
		if (!arc) throw new Error("fixture")
		arc.quests.push({
			id: questId,
			displayTitle: "",
			internalTitle: "",
			content: "",
			assetPath: null,
			answers: [],
			points: null,
			adminNotes: "",
			hints: [],
		})
		expect(arcId).toEqual(expect.any(String))
		expect(questId).toEqual(expect.any(String))
		expect(await getSeason(season._id)).toEqual(expected)

		await removeQuest(season._id, "a1", "q2", now)
		arc.quests.splice(1, 1)
		expect(await getSeason(season._id)).toEqual(expected)
		await removeArc(season._id, "a2", now)
		expected.arcs.splice(1, 1)
		expect(await getSeason(season._id)).toEqual(expected)
	})

	it.each([
		{ state: "live", start: at(0), end: at(60) },
		{ state: "ended", start: at(-60), end: at(0) },
	])("rejects all four writes while $state without changing data", async ({ start, end }) => {
		const season = await createSeason({ ...seasonInput(), start, end })
		for (const { run } of writes) {
			const rejected = run(season._id)
			await expect(rejected).rejects.toThrow(SeasonStartedError)
			await expect(rejected).rejects.toThrow("The game has started.")
			expect(await getSeason(season._id)).toEqual(season)
		}
	})

	it.each([false, true])("copies shuffleArcs=%s into new arcs", async (shuffleArcs) => {
		const season = await createSeason({ ...seasonInput(), shuffleArcs })
		const id = await addArc(season._id, now)
		expect((await getSeason(season._id))?.arcs.at(-1)).toEqual({
			id,
			title: "New arc",
			shuffleQuests: shuffleArcs,
			quests: [],
		})
	})

	it("keeps ten parallel quest adds with distinct ids", async () => {
		const season = await createSeason(seasonInput())
		const ids = await Promise.all(Array.from({ length: 10 }, () => addQuest(season._id, "a3", now)))
		expect(new Set(ids).size).toBe(10)
		const quests = (await getSeason(season._id))?.arcs[2]?.quests
		expect(quests).toHaveLength(10)
		expect(quests?.map((quest) => quest.id).toSorted()).toEqual(ids.toSorted())
	})

	it("keeps a field save racing a quest add on the same arc", async () => {
		const season = await createSeason(seasonInput())
		const [id] = await Promise.all([
			addQuest(season._id, "a1", now),
			setSeasonField(season._id, { arcId: "a1", field: "title" }, "Harbour"),
		])
		const arc = (await getSeason(season._id))?.arcs[0]
		expect(arc?.title).toBe("Harbour")
		expect(arc?.quests.map((quest) => quest.id)).toEqual(["q1", "q2", "q3", id])
	})

	it("returns only removed asset paths and empty arrays for removals without assets", async () => {
		const season = await createSeason(seasonInput())
		await setQuestAsset(season._id, "a1", "q1", "/assets/first.png")
		await setQuestAsset(season._id, "a1", "q2", "/assets/second.pdf")
		await setQuestAsset(season._id, "a2", "q4", "/assets/retained.jpg")
		expect(await removeQuest(season._id, "a1", "q2", now)).toEqual(["/assets/second.pdf"])
		expect(await removeQuest(season._id, "a1", "q3", now)).toEqual([])
		expect(await removeArc(season._id, "a1", now)).toEqual(["/assets/first.png"])
		expect(await removeArc(season._id, "a3", now)).toEqual([])
		expect((await getSeason(season._id))?.arcs).toMatchObject([
			{ id: "a2", quests: [{ id: "q4", assetPath: "/assets/retained.jpg" }] },
		])
		await setQuestAsset(season._id, "a2", "q4", null)
		expect(await removeArc(season._id, "a2", now)).toEqual([])
	})

	it("returns all non-null asset paths from a removed arc", async () => {
		const season = await createSeason(seasonInput())
		await setQuestAsset(season._id, "a1", "q1", "/assets/first.png")
		await setQuestAsset(season._id, "a1", "q3", "/assets/second.pdf")
		expect(await removeArc(season._id, "a1", now)).toEqual(["/assets/first.png", "/assets/second.pdf"])
	})

	it("rejects missing seasons for all four writes", async () => {
		for (const { run } of writes) {
			await expect(run("missing")).rejects.toThrow(NotFoundError)
		}
	})

	it.each([null, at(0)])("rejects unknown or wrongly parented items with start=%s without writing", async (start) => {
		const season = await createSeason({ ...seasonInput(), start })
		await expect(addQuest(season._id, "missing", now)).rejects.toThrow(NotFoundError)
		await expect(removeArc(season._id, "missing", now)).rejects.toThrow(NotFoundError)
		await expect(removeQuest(season._id, "missing", "q1", now)).rejects.toThrow(NotFoundError)
		await expect(removeQuest(season._id, "a1", "missing", now)).rejects.toThrow(NotFoundError)
		await expect(removeQuest(season._id, "a2", "q1", now)).rejects.toThrow(NotFoundError)
		expect(await getSeason(season._id)).toEqual(season)
	})

	it.each(writes)("atomically rejects $name if the season starts before its write", async ({ run }) => {
		const season = await createSeason(seasonInput())
		const findOneAndUpdate = Collection.prototype.findOneAndUpdate
		const write = vi.spyOn(Collection.prototype, "findOneAndUpdate").mockImplementationOnce(async function (
			this: Collection,
			...args
		) {
			await setSeasonField(season._id, { field: "start" }, now)
			return findOneAndUpdate.apply(this, args)
		})
		try {
			await expect(run(season._id)).rejects.toThrow(SeasonStartedError)
			expect(await getSeason(season._id)).toEqual({ ...season, start: now })
		} finally {
			write.mockRestore()
		}
	})
})
