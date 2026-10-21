import { describe, expect, it } from "vitest"
import { copyArc, copyDestinations, copyQuest } from "./copy"
import type { Arc, Quest, Season } from "./schemas"

const now = new Date("2026-10-13T12:00:00Z")

const quest: Quest = {
	id: "quest-source",
	hidden: true,
	displayTitle: "Display title",
	internalTitle: "Internal title",
	content: "Quest content",
	assetPath: "/assets/shared.png",
	answers: ["answer"],
	points: 20,
	adminNotes: "Admin notes",
	hints: [
		{ id: "hint-source-1", text: "First hint", points: 5 },
		{ id: "hint-source-2", text: "Second hint", points: 10 },
	],
}

const arc: Arc = {
	id: "arc-source",
	title: "Source arc",
	shuffleQuests: true,
	quests: [quest],
}

function season(
	_id: string,
	title: string,
	start: Date | null,
	end: Date | null = null,
	arcs: Season["arcs"] = [],
): Season {
	return {
		finisherBonuses: [],
		finishers: [],
		_id,
		title,
		lengthMinutes: 60,
		defaultQuestPoints: null,
		start,
		end,
		shuffleArcs: false,
		registrationOpen: false,
		arcs,
	}
}

describe("copyQuest", () => {
	it("copies every field with fresh ids, drops hidden and leaves source unchanged", () => {
		const original = structuredClone(quest)
		const copied = copyQuest(quest)

		expect(copied).toEqual({
			id: expect.any(String),
			displayTitle: quest.displayTitle,
			internalTitle: quest.internalTitle,
			content: quest.content,
			assetPath: quest.assetPath,
			answers: quest.answers,
			points: quest.points,
			adminNotes: quest.adminNotes,
			hints: quest.hints.map((hint) => ({ ...hint, id: expect.any(String) })),
		})
		const ids = [copied.id, ...copied.hints.map((hint) => hint.id)]
		expect(new Set(ids).size).toBe(ids.length)
		expect(ids).not.toContain(quest.id)
		expect(ids).not.toContain(quest.hints[0]?.id)
		expect(ids).not.toContain(quest.hints[1]?.id)
		expect(copied).not.toHaveProperty("hidden")
		copied.answers.push("new answer")
		const copiedHint = copied.hints[0]
		if (!copiedHint) throw new Error("Copy lost hint")
		copiedHint.text = "Changed hint"
		expect(quest).toEqual(original)
	})
})

describe("copyArc", () => {
	it("copies arc and nested content with fresh unique ids without mutating source", () => {
		const original = structuredClone(arc)
		const copied = copyArc(arc)
		const copiedQuest = copied.quests[0]
		if (!copiedQuest) throw new Error("Copy lost quest")
		const ids = [copied.id, copiedQuest.id, ...copiedQuest.hints.map((hint) => hint.id)]

		expect(copied).toEqual({
			id: expect.any(String),
			title: arc.title,
			shuffleQuests: arc.shuffleQuests,
			quests: [
				{
					id: expect.any(String),
					displayTitle: quest.displayTitle,
					internalTitle: quest.internalTitle,
					content: quest.content,
					assetPath: quest.assetPath,
					answers: quest.answers,
					points: quest.points,
					adminNotes: quest.adminNotes,
					hints: quest.hints.map((hint) => ({ ...hint, id: expect.any(String) })),
				},
			],
		})
		expect(new Set(ids).size).toBe(ids.length)
		expect(ids).not.toContain(arc.id)
		expect(ids).not.toContain(quest.id)
		expect(ids).not.toContain(quest.hints[0]?.id)
		expect(ids).not.toContain(quest.hints[1]?.id)
		copiedQuest.answers.push("new answer")
		const copiedHint = copiedQuest.hints[0]
		if (!copiedHint) throw new Error("Copy lost hint")
		copiedHint.text = "Changed hint"
		expect(arc).toEqual(original)
	})
})

describe("copyDestinations", () => {
	it("excludes source, live and ended seasons and orders upcoming then unscheduled", () => {
		const soon = season("soon", "Soon", new Date(now.getTime() + 60_000))
		const later = season("later", "Later", new Date(now.getTime() + 3_600_000))
		const alpha = season("alpha", "Alpha", null)
		const zulu = season("zulu", "Zulu", null)
		const source = season("source", "Source", null)
		const live = season("live", "Live", new Date(now.getTime() - 60_000), new Date(now.getTime() + 60_000))
		const ended = season("ended", "Ended", new Date(now.getTime() - 3_600_000), now)
		const seasons = [zulu, source, ended, later, live, alpha, soon]
		const original = structuredClone(seasons)

		expect(copyDestinations(seasons, source._id, now)).toEqual([
			{ id: soon._id, title: soon.title, status: "upcoming", start: soon.start, arcs: [] },
			{ id: later._id, title: later.title, status: "upcoming", start: later.start, arcs: [] },
			{ id: alpha._id, title: alpha.title, status: "unscheduled", start: null, arcs: [] },
			{ id: zulu._id, title: zulu.title, status: "unscheduled", start: null, arcs: [] },
		])
		expect(JSON.stringify(copyDestinations(seasons, source._id, now))).not.toMatch(/content|answers/)
		expect(seasons).toEqual(original)
	})

	it("returns arc summaries only and handles empty input", () => {
		const destination = season("destination", "Destination", null, null, [arc])

		expect(copyDestinations([destination], "source", now)).toEqual([
			{
				id: destination._id,
				title: destination.title,
				status: "unscheduled",
				start: null,
				arcs: [{ id: arc.id, title: arc.title }],
			},
		])
		expect(JSON.stringify(copyDestinations([destination], "source", now))).not.toMatch(/content|answers|hints/)
		expect(copyDestinations([], "source", now)).toEqual([])
	})
})
