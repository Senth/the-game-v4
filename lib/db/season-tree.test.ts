import { Collection } from "mongodb"
import { describe, expect, it, vi } from "vitest"
import { copyArc, copyQuest } from "@/lib/domain/copy"
import type { SeasonInput } from "@/lib/domain/schemas"
import { newArc, newQuest } from "@/lib/domain/season-tree"
import { useTestDb } from "@/test/db"
import { NotFoundError } from "./collections"
import {
	addArc,
	addQuest,
	CopyTargetStartedError,
	copyArcToSeason,
	copyQuestToSeason,
	createSeason,
	getSeason,
	removeArc,
	removeQuest,
	SeasonEndedError,
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

describe("copy writes", () => {
	const arc = copyArc({ ...newArc(true), quests: [newQuest()] })
	const quest = copyQuest(newQuest())
	const copies = [
		{ name: "arc", run: (id: string) => copyArcToSeason(id, arc) },
		{ name: "existing arc quest", run: (id: string) => copyQuestToSeason(id, { arcId: "a1" }, quest) },
		{
			name: "new arc quest",
			run: (id: string) => copyQuestToSeason(id, { newArc: { title: "Lighthouse", shuffleQuests: true } }, quest),
		},
	]

	it.each(copies)("atomically rejects $name if destination starts before updateOne", async ({ run }) => {
		const season = await createSeason(seasonInput())
		const original = Collection.prototype.updateOne
		const write = vi.spyOn(Collection.prototype, "updateOne").mockImplementationOnce(async function (
			this: Collection,
			...args
		) {
			await setSeasonField(season._id, { field: "start" }, new Date(0))
			return original.apply(this, args)
		})
		try {
			const copying = run(season._id)
			await expect(copying).rejects.toThrow(CopyTargetStartedError)
			await expect(copying).rejects.toThrow("Cipher Night has started. Pick another season.")
			expect(await getSeason(season._id)).toEqual({ ...season, start: new Date(0) })
		} finally {
			write.mockRestore()
		}
	})

	it.each(copies)("rejects $name when scheduled start passes while updateOne waits", async ({ run }) => {
		const season = await createSeason(seasonInput())
		const start = new Date(Date.now() + 200)
		await setSeasonField(season._id, { field: "start" }, start)
		season.start = start
		const original = Collection.prototype.updateOne
		const write = vi.spyOn(Collection.prototype, "updateOne").mockImplementationOnce(async function (
			this: Collection,
			...args
		) {
			await new Promise((resolve) => setTimeout(resolve, Math.max(0, start.getTime() - Date.now()) + 50))
			return original.apply(this, args)
		})
		try {
			await expect(run(season._id)).rejects.toThrow("Cipher Night has started. Pick another season.")
			expect(await getSeason(season._id)).toEqual(season)
		} finally {
			write.mockRestore()
		}
	})

	it.each(copies)("appends $name in one updateOne without replacing concurrent fields", async ({ name, run }) => {
		const season = await createSeason(seasonInput())
		const write = vi.spyOn(Collection.prototype, "updateOne")
		try {
			await run(season._id)
			expect(write).toHaveBeenCalledTimes(1)
			expect(write.mock.calls[0]?.[0]).toMatchObject({
				_id: season._id,
				$or: [{ start: null }, { $expr: { $gt: ["$start", "$$NOW"] } }],
			})
			expect(write.mock.calls[0]?.[1]).toHaveProperty("$push")
		} finally {
			write.mockRestore()
		}
		await Promise.all([run(season._id), setSeasonField(season._id, { arcId: "a1", field: "title" }, "Updated")])
		const stored = await getSeason(season._id)
		expect(stored?.arcs[0]?.title).toBe("Updated")
		if (name === "existing arc quest") expect(stored?.arcs[0]?.quests.slice(-2)).toEqual([quest, quest])
		else expect(stored?.arcs).toHaveLength(season.arcs.length + 2)
	})

	it.each(copies)("rejects missing season for $name", async ({ run }) => {
		await expect(run("missing")).rejects.toThrow(NotFoundError)
	})

	it("rejects missing destination arc without writing", async () => {
		const season = await createSeason(seasonInput())
		await expect(copyQuestToSeason(season._id, { arcId: "missing" }, quest)).rejects.toThrow(NotFoundError)
		expect(await getSeason(season._id)).toEqual(season)
	})
})

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
			puzzle: null,
			location: null,
			answers: [],
			points: null,
			drop: null,
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

	it.each([{ state: "ended", start: at(-60), end: at(0) }])(
		"rejects all four writes while $state without changing data",
		async ({ start, end }) => {
			const season = await createSeason({ ...seasonInput(), start, end })
			for (const { run } of writes) {
				const rejected = run(season._id)
				await expect(rejected).rejects.toThrow(SeasonEndedError)
				await expect(rejected).rejects.toThrow("The game has ended.")
				expect(await getSeason(season._id)).toEqual(season)
			}
		},
	)

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
		expect(await removeQuest(season._id, "a1", "q2", now)).toEqual({ assetPaths: ["/assets/second.pdf"], affected: [] })
		expect(await removeQuest(season._id, "a1", "q3", now)).toEqual({ assetPaths: [], affected: [] })
		expect(await removeArc(season._id, "a1", now)).toEqual({ assetPaths: ["/assets/first.png"], affected: [] })
		expect(await removeArc(season._id, "a3", now)).toEqual({ assetPaths: [], affected: [] })
		expect((await getSeason(season._id))?.arcs).toMatchObject([
			{ id: "a2", quests: [{ id: "q4", assetPath: "/assets/retained.jpg" }] },
		])
		await setQuestAsset(season._id, "a2", "q4", null)
		expect(await removeArc(season._id, "a2", now)).toEqual({ assetPaths: [], affected: [] })
	})

	it("returns all non-null asset paths from a removed arc", async () => {
		const season = await createSeason(seasonInput())
		await setQuestAsset(season._id, "a1", "q1", "/assets/first.png")
		await setQuestAsset(season._id, "a1", "q3", "/assets/second.pdf")
		expect(await removeArc(season._id, "a1", now)).toEqual({
			assetPaths: ["/assets/first.png", "/assets/second.pdf"],
			affected: [],
		})
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

	it("atomically rejects a visible quest addition if the season starts before its write", async () => {
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
			await expect(addQuest(season._id, "a1", now)).rejects.toThrow(SeasonStartedError)
			expect(await getSeason(season._id)).toEqual({ ...season, start: now })
		} finally {
			write.mockRestore()
		}
	})

	it.each(writes)("atomically rejects $name if the season ends before its write", async ({ run }) => {
		const season = await createSeason({ ...seasonInput(), start: at(-1), end: at(59) })
		const original = Collection.prototype.findOneAndUpdate
		const write = vi.spyOn(Collection.prototype, "findOneAndUpdate").mockImplementationOnce(async function (
			this: Collection,
			...args
		) {
			await setSeasonField(season._id, { field: "end" }, now)
			return original.apply(this, args)
		})
		try {
			await expect(run(season._id)).rejects.toThrow(SeasonEndedError)
			expect(await getSeason(season._id)).toEqual({ ...season, end: now })
		} finally {
			write.mockRestore()
		}
	})
})
