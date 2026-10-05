import { describe, expect, it } from "vitest"
import type { Quest, SeasonInput } from "@/lib/domain/schemas"
import { useTestDb } from "@/test/db"
import { NotFoundError } from "./collections"
import { createSeason, getSeason, listSeasons, setSeasonField } from "./seasons"

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

function seasonInput(): Omit<SeasonInput, "_id"> {
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
})
