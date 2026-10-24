import { Collection } from "mongodb"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { scheduleWindow, startNowWindow } from "@/lib/domain/admin-seasons"
import type { Quest, SeasonInput } from "@/lib/domain/schemas"
import { useTestDb } from "@/test/db"
import { collections, NotFoundError } from "./collections"
import {
	createSeason,
	getSeason,
	isAssetReferenced,
	listSeasons,
	patchSeasonList,
	RegistrationConflictError,
	SeasonOverlapError,
	StaleWindowError,
	setQuestAsset,
	setRegistrationOpen,
	setSeasonField,
	setSeasonLength,
	setSeasonWindow,
} from "./seasons"
import { createTeam, getTeam, revealHint } from "./teams"

useTestDb()

function quest(id: string): Quest {
	return {
		id,
		displayTitle: `Title ${id}`,
		internalTitle: id,
		content: "",
		assetPath: null,
		puzzle: null,
		answers: [],
		points: null,
		adminNotes: "",
		hints: [{ id: `${id}-h1`, text: "First", points: 5 }],
	}
}

function seasonInput(): Omit<SeasonInput, "_id" | "registrationOpen"> {
	return {
		title: "Cipher Night",
		lengthMinutes: 120,
		start: null,
		end: null,
		shuffleArcs: false,
		arcs: [
			{ id: "a1", title: "Lighthouse", shuffleQuests: false, quests: [quest("q1"), quest("q2")] },
			{ id: "a2", title: "Old Town", shuffleQuests: true, quests: [quest("q3")] },
		],
	}
}

describe("seasons", () => {
	it("creates, gets and lists seasons and fills missing hint ids", async () => {
		const input = seasonInput()
		input.arcs[0]?.quests[0]?.hints.push({ text: "Second", points: 10 })
		const season = await createSeason(input)
		const named = await createSeason({ ...seasonInput(), _id: "cipher-night" })

		expect(named._id).toBe("cipher-night")
		expect(await getSeason(season._id)).toEqual(season)
		expect(season.arcs[0]?.quests[0]?.hints[1]?.id).toEqual(expect.any(String))
		expect((await listSeasons()).map((s) => s._id)).toEqual(expect.arrayContaining([season._id, "cipher-night"]))
	})

	it("reads legacy seasons without default quest points as null", async () => {
		const season = await createSeason(seasonInput())
		await (await collections()).seasons.updateOne({ _id: season._id }, { $unset: { defaultQuestPoints: "" } })
		expect(await getSeason(season._id)).toMatchObject({ defaultQuestPoints: null })
		expect(await listSeasons()).toEqual(
			expect.arrayContaining([expect.objectContaining({ _id: season._id, defaultQuestPoints: null })]),
		)
	})

	it("saves and reads map area without changing existing places, and reads legacy map area as null", async () => {
		const season = await createSeason(seasonInput())
		const location = { guidance: "map" as const, places: [{ id: "place-1", lat: 55.5, lng: 13.2, radius: 75 }] }
		await setSeasonField(season._id, { arcId: "a1", questId: "q1", field: "location" }, location)
		await setSeasonField(season._id, { field: "mapArea" }, { lat: 55.5079126, lng: 13.2353126, zoom: 12.345 })
		const saved = await getSeason(season._id)
		expect(saved?.mapArea).toEqual({ lat: 55.507913, lng: 13.235313, zoom: 12.35 })
		expect(saved?.arcs[0]?.quests[0]?.location).toEqual(location)
		await (await collections()).seasons.updateOne({ _id: season._id }, { $unset: { mapArea: "" } })
		const legacy = await getSeason(season._id)
		expect(legacy?.mapArea).toBeNull()
		expect(legacy?.arcs[0]?.quests[0]?.location).toEqual(location)
		expect(await listSeasons()).toEqual(
			expect.arrayContaining([expect.objectContaining({ _id: season._id, mapArea: null })]),
		)
	})

	it("sets a season, arc, quest and hint field on that path only", async () => {
		const season = await createSeason(seasonInput())
		await setSeasonField(season._id, { field: "title" }, "Cipher Night 2026")
		await setSeasonField(season._id, { arcId: "a2", field: "title" }, "Harbor")
		await setSeasonField(season._id, { arcId: "a1", questId: "q2", field: "displayTitle" }, "Beacon")
		await setSeasonField(season._id, { arcId: "a1", questId: "q2", hintId: "q2-h1", field: "text" }, "Look up")

		const expected = structuredClone(season)
		expected.title = "Cipher Night 2026"
		const [lighthouse, oldTown] = expected.arcs
		if (!lighthouse || !oldTown) throw new Error("fixture")
		oldTown.title = "Harbor"
		lighthouse.quests[1] = {
			...quest("q2"),
			location: null,
			displayTitle: "Beacon",
			hints: [{ id: "q2-h1", text: "Look up", points: 5 }],
		}
		expect(await getSeason(season._id)).toEqual(expected)
	})

	it("assigns ids to hints set without them", async () => {
		const season = await createSeason(seasonInput())
		await setSeasonField(season._id, { arcId: "a1", questId: "q1", field: "hints" }, [
			{ text: "New", points: 1 },
			{ id: "q1-h1", text: "First", points: 5 },
		])

		const hints = (await getSeason(season._id))?.arcs[0]?.quests[0]?.hints
		expect(hints?.[0]?.id).toEqual(expect.any(String))
		expect(hints?.[1]?.id).toBe("q1-h1")
	})

	it("throws for unknown ids and invalid values before writing", async () => {
		const season = await createSeason(seasonInput())

		await expect(setSeasonField("missing", { field: "title" }, "x")).rejects.toThrow(NotFoundError)
		await expect(setSeasonField(season._id, { arcId: "nope", field: "title" }, "x")).rejects.toThrow(NotFoundError)
		await expect(
			setSeasonField(season._id, { arcId: "a2", questId: "q1", field: "displayTitle" }, "x"),
		).rejects.toThrow(NotFoundError)
		await expect(
			setSeasonField(season._id, { arcId: "a1", questId: "q1", hintId: "nope", field: "text" }, "x"),
		).rejects.toThrow(NotFoundError)
		await expect(setSeasonField(season._id, { field: "lengthMinutes" }, "long")).rejects.toThrow()
		await expect(setSeasonField(season._id, { arcId: "a1", questId: "q1", field: "points" }, "ten")).rejects.toThrow()

		expect(await getSeason(season._id)).toEqual(season)
	})

	it("keeps both of two concurrent quest field edits", async () => {
		const season = await createSeason(seasonInput())
		await Promise.all([
			setSeasonField(season._id, { arcId: "a1", questId: "q1", field: "content" }, "Decode this"),
			setSeasonField(season._id, { arcId: "a1", questId: "q1", field: "answers" }, ["lamp"]),
		])

		expect((await getSeason(season._id))?.arcs[0]?.quests[0]).toMatchObject({
			content: "Decode this",
			answers: ["lamp"],
		})
	})

	it("targets a quest by id after its arc is reordered", async () => {
		const season = await createSeason(seasonInput())
		await setSeasonField(season._id, { arcId: "a1", field: "quests" }, [quest("q2"), quest("q1")])
		await setSeasonField(season._id, { arcId: "a1", questId: "q1", field: "points" }, 50)

		const quests = (await getSeason(season._id))?.arcs[0]?.quests
		expect(quests?.map((q) => [q.id, q.points])).toEqual([
			["q2", null],
			["q1", 50],
		])
	})

	it("cleans answers and skips sequential normalized duplicates; concurrent Fyren/fyren duplicates are harmless", async () => {
		const season = await createSeason(seasonInput())
		const target = { arcId: "a1", questId: "q1", field: "answers" } as const
		await patchSeasonList(season._id, target, { op: "add", value: " Fyren " })
		expect((await getSeason(season._id))?.arcs[0]?.quests[0]?.answers).toEqual(["Fyren"])
		const write = vi.spyOn(Collection.prototype, "updateOne")
		try {
			await expect(patchSeasonList(season._id, target, { op: "add", value: "fyren" })).resolves.toBeUndefined()
			expect(write).not.toHaveBeenCalled()
		} finally {
			write.mockRestore()
		}
		expect((await getSeason(season._id))?.arcs[0]?.quests[0]?.answers).toEqual(["Fyren"])
		await patchSeasonList(season._id, target, { op: "add", value: " a\u030a " })
		await patchSeasonList(season._id, target, { op: "add", value: "å" })
		expect((await getSeason(season._id))?.arcs[0]?.quests[0]?.answers).toEqual(["Fyren", "å"])
	})

	it.each(["", "   ", "x".repeat(201)])("rejects invalid answer %j without writing", async (value) => {
		const season = await createSeason(seasonInput())
		await expect(
			patchSeasonList(season._id, { arcId: "a1", questId: "q1", field: "answers" }, { op: "add", value }),
		).rejects.toThrow()
		expect(await getSeason(season._id)).toEqual(season)
	})

	it("checks answer length after trim and NFC and accepts 200 characters", async () => {
		const season = await createSeason(seasonInput())
		const target = { arcId: "a1", questId: "q1", field: "answers" } as const
		await patchSeasonList(season._id, target, { op: "add", value: ` ${"a\u030a".repeat(200)} ` })
		expect((await getSeason(season._id))?.arcs[0]?.quests[0]?.answers).toEqual(["å".repeat(200)])
	})

	it("removes only the exact stored answer, including legacy whitespace and decomposed Unicode", async () => {
		const season = await createSeason(seasonInput())
		const target = { arcId: "a1", questId: "q1", field: "answers" } as const
		await setSeasonField(season._id, target, [" Fyren ", "Fyren", "a\u030a", "å"])
		await patchSeasonList(season._id, target, { op: "remove", value: " Fyren " })
		await patchSeasonList(season._id, target, { op: "remove", value: "a\u030a" })
		expect((await getSeason(season._id))?.arcs[0]?.quests[0]?.answers).toEqual(["Fyren", "å"])
	})

	it.each(["", "   ", "x".repeat(201)])("removes legacy answer %j without add validation", async (value) => {
		const season = await createSeason(seasonInput())
		const target = { arcId: "a1", questId: "q1", field: "answers" } as const
		await setSeasonField(season._id, target, [value, "keeper"])
		await expect(patchSeasonList(season._id, target, { op: "remove", value })).resolves.toBeUndefined()
		expect((await getSeason(season._id))?.arcs[0]?.quests[0]?.answers).toEqual(["keeper"])
		await patchSeasonList(season._id, target, { op: "add", value: "lamp" })
		expect((await getSeason(season._id))?.arcs[0]?.quests[0]?.answers).toEqual(["keeper", "lamp"])
	})

	it("keeps concurrent answer adds and deduplicates repeated values", async () => {
		const season = await createSeason(seasonInput())
		const target = { arcId: "a1", questId: "q1", field: "answers" } as const
		await Promise.all([
			patchSeasonList(season._id, target, { op: "add", value: "lamp" }),
			patchSeasonList(season._id, target, { op: "add", value: "beacon" }),
		])
		await patchSeasonList(season._id, target, { op: "add", value: "lamp" })
		const expected = structuredClone(season)
		const stored = await getSeason(season._id)
		const answers = stored?.arcs[0]?.quests[0]?.answers
		expect(answers?.toSorted()).toEqual(["beacon", "lamp"])
		const q = expected.arcs[0]?.quests[0]
		if (!q || !answers) throw new Error("fixture")
		q.answers = answers
		expect(stored).toEqual(expected)
	})

	it("keeps a hint add alongside another hint's concurrent text edit", async () => {
		const season = await createSeason(seasonInput())
		const target = { arcId: "a1", questId: "q1", field: "hints" } as const
		const [id] = await Promise.all([
			patchSeasonList(season._id, target, { op: "add", hint: { id: "new-hint", text: "Second", points: 10 } }),
			setSeasonField(season._id, { ...target, hintId: "q1-h1", field: "text" }, "Edited"),
		])
		expect(id).toBe("new-hint")
		expect((await getSeason(season._id))?.arcs[0]?.quests[0]?.hints).toEqual([
			{ id: "q1-h1", text: "Edited", points: 5 },
			{ id, text: "Second", points: 10 },
		])
	})

	it("deduplicates concurrent and repeated hint adds by id without overwriting edits", async () => {
		const season = await createSeason(seasonInput())
		const target = { arcId: "a1", questId: "q1", field: "hints" } as const
		const op = { op: "add", hint: { id: "new-hint", text: "Second", points: 10 } } as const
		expect(
			await Promise.all([patchSeasonList(season._id, target, op), patchSeasonList(season._id, target, op)]),
		).toEqual(["new-hint", "new-hint"])
		expect((await getSeason(season._id))?.arcs[0]?.quests[0]?.hints).toEqual([
			{ id: "q1-h1", text: "First", points: 5 },
			op.hint,
		])
		await setSeasonField(season._id, { ...target, hintId: op.hint.id, field: "text" }, "Edited")
		expect(await patchSeasonList(season._id, target, op)).toBe("new-hint")
		expect((await getSeason(season._id))?.arcs[0]?.quests[0]?.hints).toEqual([
			{ id: "q1-h1", text: "First", points: 5 },
			{ ...op.hint, text: "Edited" },
		])
		expect(await patchSeasonList(season._id, { ...target, questId: "q2" }, op)).toBe("new-hint")
		expect((await getSeason(season._id))?.arcs[0]?.quests[1]?.hints).toEqual([
			{ id: "q2-h1", text: "First", points: 5 },
			op.hint,
		])
		await expect(patchSeasonList(season._id, { ...target, arcId: "a2" }, op)).rejects.toThrow(NotFoundError)
	})

	it("keeps concurrent hint adds with distinct generated ids", async () => {
		const season = await createSeason(seasonInput())
		const target = { arcId: "a1", questId: "q1", field: "hints" } as const
		const ids = await Promise.all([
			patchSeasonList(season._id, target, { op: "add", hint: { text: "Second", points: 10 } }),
			patchSeasonList(season._id, target, { op: "add", hint: { text: "Third", points: 15 } }),
		])
		expect(ids).toEqual([expect.any(String), expect.any(String)])
		expect(new Set(ids).size).toBe(2)
		const hints = (await getSeason(season._id))?.arcs[0]?.quests[0]?.hints
		expect(hints).toHaveLength(3)
		expect(hints).toEqual(
			expect.arrayContaining([
				{ id: "q1-h1", text: "First", points: 5 },
				{ id: ids[0], text: "Second", points: 10 },
				{ id: ids[1], text: "Third", points: 15 },
			]),
		)
	})

	it("removes answers by value and hints by id, with missing items a no-op", async () => {
		const season = await createSeason(seasonInput())
		const target = { arcId: "a1", questId: "q1" }
		await setSeasonField(season._id, { ...target, field: "answers" }, ["lamp", "beacon"])
		await patchSeasonList(season._id, { ...target, field: "answers" }, { op: "remove", value: "lamp" })
		await patchSeasonList(season._id, { ...target, field: "hints" }, { op: "remove", hintId: "q1-h1" })
		const stored = await getSeason(season._id)
		expect(stored?.arcs[0]?.quests[0]).toMatchObject({ answers: ["beacon"], hints: [] })
		await patchSeasonList(season._id, { ...target, field: "answers" }, { op: "remove", value: "missing" })
		await patchSeasonList(season._id, { ...target, field: "hints" }, { op: "remove", hintId: "missing" })
		expect(await getSeason(season._id)).toEqual(stored)
	})

	it("leaves revealed-hint snapshots untouched by hint list patches", async () => {
		const season = await createSeason(seasonInput())
		const team = await createTeam({
			name: crypto.randomUUID(),
			passwordHash: "$2b$10$hash",
			seasonId: season._id,
			questOrder: ["q1"],
			questIndex: 0,
			score: 0,
			completed: false,
			progress: [],
		})
		await revealHint(
			team._id,
			{ questIndex: 0, questId: "q1" },
			{
				hintId: "q1-h1",
				text: "First",
				points: 5,
				revealedAt: new Date(),
			},
		)
		const before = await getTeam(team._id)
		const target = { arcId: "a1", questId: "q1", field: "hints" } as const
		await patchSeasonList(season._id, target, { op: "remove", hintId: "q1-h1" })
		await patchSeasonList(season._id, target, { op: "add", hint: { id: "q1-h1", text: "Replacement", points: 20 } })
		expect(await getTeam(team._id)).toEqual(before)
	})

	it("rejects list patches for unknown season, arc or quest and invalid payloads without writing", async () => {
		const season = await createSeason(seasonInput())
		const target = { arcId: "a1", questId: "q1", field: "answers" } as const
		await expect(patchSeasonList("missing", target, { op: "add", value: "lamp" })).rejects.toThrow(NotFoundError)
		await expect(
			patchSeasonList(season._id, { ...target, arcId: "missing" }, { op: "remove", value: "lamp" }),
		).rejects.toThrow(NotFoundError)
		await expect(
			patchSeasonList(season._id, { ...target, questId: "missing" }, { op: "add", value: "lamp" }),
		).rejects.toThrow(NotFoundError)
		await expect(
			patchSeasonList(season._id, { ...target, arcId: "a2" }, { op: "remove", value: "lamp" }),
		).rejects.toThrow(NotFoundError)
		const invalidAnswer = { op: "add", value: 42 } as unknown as Parameters<typeof patchSeasonList>[2]
		const invalidHint = { op: "add", hint: { points: 5 } } as unknown as Parameters<typeof patchSeasonList>[2]
		await expect(patchSeasonList(season._id, target, invalidAnswer)).rejects.toThrow()
		await expect(patchSeasonList(season._id, { ...target, field: "hints" }, invalidHint)).rejects.toThrow()
		expect(await getSeason(season._id)).toEqual(season)
	})

	it("opens registration on one counting season and rejects a second, naming the first", async () => {
		const now = new Date("2026-03-14T18:00:00Z")
		const a = await createSeason({ ...seasonInput(), title: "Season A" })
		const b = await createSeason({ ...seasonInput(), title: "Season B" })
		await setRegistrationOpen(a._id, true, now)
		await setRegistrationOpen(a._id, true, now)

		const rejected = setRegistrationOpen(b._id, true, now)
		await expect(rejected).rejects.toThrow(RegistrationConflictError)
		await expect(rejected).rejects.toThrow("Season A")
		expect((await getSeason(a._id))?.registrationOpen).toBe(true)
		expect((await getSeason(b._id))?.registrationOpen).toBe(false)

		await setRegistrationOpen(a._id, false, now)
		await setRegistrationOpen(b._id, true, now)
		expect((await getSeason(b._id))?.registrationOpen).toBe(true)
		await setRegistrationOpen(b._id, false, now)
	})

	it("ignores an ended season's flag and refuses to open an ended season", async () => {
		const now = new Date("2026-03-14T18:00:00Z")
		const ended = await createSeason({ ...seasonInput(), title: "Old", end: new Date(now.getTime() - 1) })
		const next = await createSeason(seasonInput())
		await setRegistrationOpen(ended._id, true, new Date(now.getTime() - 60_000))

		await setRegistrationOpen(next._id, true, now)
		await expect(setRegistrationOpen(ended._id, true, now)).rejects.toThrow(RegistrationConflictError)
		expect((await getSeason(next._id))?.registrationOpen).toBe(true)
		await setRegistrationOpen(next._id, false, now)
	})

	it("rejects an end edit that revives a flagged ended season while another counting season is open", async () => {
		const ended = await createSeason({ ...seasonInput(), end: new Date(Date.now() - 60_000) })
		const open = await createSeason({ ...seasonInput(), title: "Season Open" })
		await setRegistrationOpen(ended._id, true, new Date(Date.now() - 120_000))
		await setRegistrationOpen(open._id, true)

		const revived = setSeasonField(ended._id, { field: "end" }, null)
		await expect(revived).rejects.toThrow(RegistrationConflictError)
		await expect(revived).rejects.toThrow("Season Open")
		expect((await getSeason(ended._id))?.end).not.toBeNull()

		const stillEnded = new Date(Date.now() - 1_000)
		await setSeasonField(ended._id, { field: "end" }, stillEnded)
		expect((await getSeason(ended._id))?.end).toEqual(stillEnded)
		await setRegistrationOpen(open._id, false)
	})

	it("ignores a flag passed to createSeason", async () => {
		const season = await createSeason({ ...seasonInput(), registrationOpen: true } as Parameters<
			typeof createSeason
		>[0])

		expect((await getSeason(season._id))?.registrationOpen).toBe(false)
	})

	it("throws for an unknown season and refuses registrationOpen through setSeasonField", async () => {
		const season = await createSeason(seasonInput())
		const open = await createSeason(seasonInput())
		await setRegistrationOpen(open._id, true)

		await expect(setRegistrationOpen("missing", true)).rejects.toThrow(NotFoundError)
		await expect(setSeasonField(season._id, { field: "registrationOpen" }, true)).rejects.toThrow("setRegistrationOpen")
		expect((await getSeason(season._id))?.registrationOpen).toBe(false)
		await setRegistrationOpen(open._id, false)
	})
})

describe("quest asset writes", () => {
	const first = "/assets/01234567-89ab-cdef-0123-456789abcdef.png"
	const second = "/assets/11234567-89ab-cdef-0123-456789abcdef.pdf"

	beforeEach(async () => {
		await (await collections()).seasons.deleteMany({})
	})

	it.each([
		{ state: "unscheduled", start: null, end: null },
		{ state: "upcoming", start: new Date(Date.now() + 60_000), end: new Date(Date.now() + 120_000) },
		{ state: "live", start: new Date(Date.now() - 60_000), end: new Date(Date.now() + 60_000) },
		{ state: "ended", start: new Date(Date.now() - 120_000), end: new Date(Date.now() - 60_000) },
	])("sets, replaces and clears only the quest asset while $state", async ({ start, end }) => {
		const season = await createSeason({ ...seasonInput(), start, end })
		expect(await setQuestAsset(season._id, "a1", "q2", first)).toBeNull()
		const expected = structuredClone(season)
		const quest = expected.arcs[0]?.quests[1]
		if (!quest) throw new Error("fixture")
		quest.assetPath = first
		expect(await getSeason(season._id)).toEqual(expected)
		expect(await setQuestAsset(season._id, "a1", "q2", second)).toBe(first)
		quest.assetPath = second
		expect(await getSeason(season._id)).toEqual(expected)
		expect(await setQuestAsset(season._id, "a1", "q2", null)).toBe(second)
		expect(await getSeason(season._id)).toEqual(season)
	})

	it("rejects missing or wrongly parented quests without writing", async () => {
		const season = await createSeason(seasonInput())
		for (const [seasonId, arcId, questId] of [
			["missing", "a1", "q1"],
			[season._id, "missing", "q1"],
			[season._id, "a1", "missing"],
			[season._id, "a2", "q1"],
		] as const) {
			await expect(setQuestAsset(seasonId, arcId, questId, first)).rejects.toThrow(NotFoundError)
		}
		expect(await getSeason(season._id)).toEqual(season)
	})

	it("keeps concurrent content and asset edits", async () => {
		const season = await createSeason(seasonInput())
		await Promise.all([
			setSeasonField(season._id, { arcId: "a1", questId: "q1", field: "content" }, "Decode this"),
			setQuestAsset(season._id, "a1", "q1", first),
		])
		expect((await getSeason(season._id))?.arcs[0]?.quests[0]).toMatchObject({
			content: "Decode this",
			assetPath: first,
		})
	})

	it("finds shared references across seasons until the last is cleared", async () => {
		const season = await createSeason(seasonInput())
		const other = await createSeason(seasonInput())
		expect(await isAssetReferenced(first)).toBe(false)
		await setQuestAsset(season._id, "a1", "q1", first)
		await setQuestAsset(other._id, "a2", "q3", first)
		await setQuestAsset(season._id, "a1", "q1", null)
		expect(await isAssetReferenced(first)).toBe(true)
		expect(await isAssetReferenced(second)).toBe(false)
		await setQuestAsset(other._id, "a2", "q3", null)
		expect(await isAssetReferenced(first)).toBe(false)
	})
})

describe("season window writes", () => {
	const now = new Date("2026-10-24T17:00:00Z")
	const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000)
	const empty = { start: null, end: null }

	beforeEach(async () => {
		await (await collections()).seasons.deleteMany({})
	})

	it("applies one of two concurrent writes with the same expected window", async () => {
		const season = await createSeason(seasonInput())
		const next = { start: at(1), end: at(121) }
		const results = await Promise.allSettled([
			setSeasonWindow(season._id, empty, next, now),
			setSeasonWindow(season._id, empty, next, now),
		])

		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
		const rejected = results.find((result) => result.status === "rejected")
		expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(StaleWindowError)
		expect(await getSeason(season._id)).toEqual({ ...season, ...next })
	})

	it.each(["start now", "schedule"])("rejects stale length when deriving %s before the window read", async (action) => {
		const season = await createSeason({ ...seasonInput(), lengthMinutes: 60 })
		const next = action === "start now" ? startNowWindow(season, now) : scheduleWindow(at(10), season.lengthMinutes)
		await setSeasonLength(season._id, 120, now)

		await expect(setSeasonWindow(season._id, season, next, now)).rejects.toThrow(StaleWindowError)
		expect(await getSeason(season._id)).toEqual({ ...season, lengthMinutes: 120 })
	})

	it.each(["start now", "schedule"])("rejects concurrent length edits before the %s window write", async (action) => {
		const season = await createSeason({ ...seasonInput(), lengthMinutes: 60 })
		const next = action === "start now" ? startNowWindow(season, now) : scheduleWindow(at(10), season.lengthMinutes)
		const updateOne = Collection.prototype.updateOne
		const write = vi.spyOn(Collection.prototype, "updateOne").mockImplementationOnce(async function (
			this: Collection,
			...args
		) {
			await setSeasonLength(season._id, 120, now)
			return updateOne.apply(this, args)
		})
		try {
			await expect(setSeasonWindow(season._id, season, next, now)).rejects.toThrow(StaleWindowError)
			expect(await getSeason(season._id)).toEqual({ ...season, lengthMinutes: 120 })
		} finally {
			write.mockRestore()
		}
	})

	it.each(["start", "end"] as const)("rejects a stale expected %s without changing either date", async (field) => {
		const season = await createSeason({ ...seasonInput(), start: at(10), end: at(130) })
		await createSeason({ ...seasonInput(), start: at(130), end: at(250) })
		const expected = { start: season.start, end: season.end, [field]: at(20) }
		await expect(setSeasonWindow(season._id, expected, { start: at(15), end: at(135) }, now)).rejects.toThrow(
			StaleWindowError,
		)
		expect(await getSeason(season._id)).toEqual(season)
	})

	it.each([-30, 30])("rejects overlap with a season starting %i minutes from now without writing", async (start) => {
		const blocker = await createSeason({ ...seasonInput(), title: "Spring Hunt", start: at(start), end: at(90) })
		const season = await createSeason(seasonInput())
		const rejected = setSeasonWindow(season._id, empty, { start: at(60), end: at(180) }, now)

		await expect(rejected).rejects.toBeInstanceOf(SeasonOverlapError)
		await expect(rejected).rejects.toMatchObject({ season: blocker })
		await expect(rejected).rejects.toThrow("Spring Hunt")
		expect(await getSeason(season._id)).toEqual(season)
		expect(await getSeason(blocker._id)).toEqual(blocker)
	})

	it("allows touching windows, updates its own window and clears both dates together", async () => {
		await createSeason({ ...seasonInput(), start: at(-30), end: at(30) })
		await createSeason({ ...seasonInput(), start: at(150), end: at(270) })
		const season = await createSeason(seasonInput())
		const next = { start: at(30), end: at(150) }
		await setSeasonWindow(season._id, empty, next, now)
		const shorter = { ...next, end: at(145) }
		await setSeasonWindow(season._id, next, shorter, now)
		expect(await getSeason(season._id)).toEqual({ ...season, ...shorter })
		await setSeasonWindow(season._id, shorter, empty, now)
		expect(await getSeason(season._id)).toEqual(season)
	})

	it("refuses to reopen a flagged ended season while another counting season has registration open", async () => {
		const ended = await createSeason({ ...seasonInput(), start: at(-120), end: at(0) })
		await setRegistrationOpen(ended._id, true, at(-1))
		const open = await createSeason({ ...seasonInput(), title: "Season Open" })
		await setRegistrationOpen(open._id, true, now)
		const before = await getSeason(ended._id)
		const next = { start: ended.start, end: at(5) }
		const rejected = setSeasonWindow(ended._id, ended, next, now)
		await expect(rejected).rejects.toThrow(RegistrationConflictError)
		await expect(rejected).rejects.toThrow('Registration is already open for "Season Open"')
		expect(await getSeason(ended._id)).toEqual(before)
		await setSeasonWindow(ended._id, ended, { start: ended.start, end: at(-1) }, now)
		await setRegistrationOpen(open._id, false, now)
		await setSeasonWindow(ended._id, { start: ended.start, end: at(-1) }, next, now)
		expect(await getSeason(ended._id)).toEqual({ ...before, ...next })
	})

	it("validates window dates and rejects missing seasons without writing", async () => {
		const season = await createSeason(seasonInput())
		await expect(setSeasonWindow("missing", empty, empty, now)).rejects.toThrow(NotFoundError)
		await expect(
			setSeasonWindow(season._id, empty, { start: new Date("invalid"), end: at(120) }, now),
		).rejects.toThrow()
		expect(await getSeason(season._id)).toEqual(season)
	})

	it.each([
		{ state: "unscheduled", start: null, end: null, nextEnd: null },
		{ state: "upcoming", start: at(1), end: at(121), nextEnd: at(61) },
	])("changes length while $state and keeps its window consistent", async ({ start, end, nextEnd }) => {
		const season = await createSeason({ ...seasonInput(), start, end })
		await setSeasonLength(season._id, 60, now)
		expect(await getSeason(season._id)).toEqual({ ...season, lengthMinutes: 60, end: nextEnd })
	})

	it.each([
		{ state: "live", start: at(0), end: at(120) },
		{ state: "ended", start: at(-120), end: at(0) },
	])("locks length while $state", async ({ start, end }) => {
		const season = await createSeason({ ...seasonInput(), start, end })
		await expect(setSeasonLength(season._id, 60, now)).rejects.toThrow("Set at start")
		expect(await getSeason(season._id)).toEqual(season)
	})

	it("checks overlap when changing upcoming length and permits touching the next season", async () => {
		const season = await createSeason({ ...seasonInput(), start: at(30), end: at(150) })
		await createSeason({ ...seasonInput(), start: at(150), end: at(270) })
		await expect(setSeasonLength(season._id, 121, now)).rejects.toThrow(SeasonOverlapError)
		expect(await getSeason(season._id)).toEqual(season)
		await setSeasonLength(season._id, 120, now)
		expect(await getSeason(season._id)).toEqual(season)
	})

	it("validates length before writing and rejects missing seasons", async () => {
		const season = await createSeason(seasonInput())
		for (const minutes of [0, 1441, 1.5, Number.NaN]) {
			await expect(setSeasonLength(season._id, minutes, now)).rejects.toThrow()
		}
		await expect(setSeasonLength("missing", 60, now)).rejects.toThrow(NotFoundError)
		expect(await getSeason(season._id)).toEqual(season)
	})
})
