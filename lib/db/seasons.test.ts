import { describe, expect, it } from "vitest"
import type { Quest, SeasonInput } from "@/lib/domain/schemas"
import { useTestDb } from "@/test/db"
import { NotFoundError } from "./collections"
import {
	createSeason,
	getSeason,
	listSeasons,
	patchSeasonList,
	RegistrationConflictError,
	setRegistrationOpen,
	setSeasonField,
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
