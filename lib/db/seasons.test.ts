import { describe, expect, it } from "vitest"
import type { Quest, SeasonInput } from "@/lib/domain/schemas"
import { useTestDb } from "@/test/db"
import { NotFoundError } from "./collections"
import {
	createSeason,
	getSeason,
	listSeasons,
	RegistrationConflictError,
	setRegistrationOpen,
	setSeasonField,
} from "./seasons"

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
