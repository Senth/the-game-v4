import { describe, expect, it } from "vitest"
import { buildFixture } from "@/scripts/fixture"
import { previewGame } from "./preview"

const now = new Date("2026-10-09T18:00:00Z")
const fixture = buildFixture(now)
const baseSeason = fixture.season
const targetArc = baseSeason.arcs[1]
const authoredQuest = targetArc?.quests[2]
const authoredHint = authoredQuest?.hints[0]

if (!targetArc || !authoredQuest || !authoredHint) throw new Error("Fixture must include the previewed quest and hint")

describe("previewGame", () => {
	it.each([null, { fullMinutes: 0, dropMinutes: 10, floor: 5 }])("whitelists scoring data for drop %j", (drop) => {
		const quest = {
			...authoredQuest,
			points: 50,
			drop,
			internalTitle: "secret-title",
			adminNotes: "secret-notes",
			answers: ["secret-answer"],
			hints: [{ ...authoredHint, text: "secret-hint" }],
		}
		const view = previewGame(baseSeason, quest, now).quest
		expect(view).toMatchObject({ drop: drop ? { ...drop, reachedAt: now.getTime() } : null, hintPenalty: 0, worth: 50 })
		expect(Object.keys(view).sort()).toEqual([
			"assetPath",
			"content",
			"displayTitle",
			"drop",
			"hintPenalty",
			"hints",
			"id",
			"points",
			"worth",
		])
		expect(JSON.stringify(view)).not.toContain("secret-")
	})

	it.each([
		["unscheduled", { start: null, end: null }, baseSeason.lengthMinutes * 60_000],
		[
			"countdown",
			{ start: new Date(now.getTime() + 1), end: new Date(now.getTime() + 60_000) },
			baseSeason.lengthMinutes * 60_000,
		],
		["running", { start: new Date(now.getTime() - 1), end: new Date(now.getTime() + 60_000) }, 60_000],
		["ended", { start: new Date(now.getTime() - 60_000), end: new Date(now.getTime() - 1) }, 0],
	] as const)("uses correct clock for %s season", (_state, dates, timeLeftMs) => {
		expect(previewGame({ ...baseSeason, ...dates }, authoredQuest, now).timeLeftMs).toBe(timeLeftMs)
	})

	it("projects a draft as player-safe quest props and keeps authored rail position", () => {
		const quest = {
			...authoredQuest,
			internalTitle: "internal title secret",
			answers: ["answer secret"],
			adminNotes: "admin note secret",
			hints: [{ ...authoredHint, text: "hint text secret" }],
		}
		const before = structuredClone({ season: baseSeason, quest })
		const result = previewGame(baseSeason, quest, now)

		expect(JSON.stringify(result)).not.toContain("internal title secret")
		expect(JSON.stringify(result)).not.toContain("answer secret")
		expect(JSON.stringify(result)).not.toContain("admin note secret")
		expect(JSON.stringify(result)).not.toContain("hint text secret")
		expect(result.preview).toBe(true)
		expect(result.pace).toBeNull()
		expect(result).not.toHaveProperty("strip")
		expect(result.rail.find(({ arcId }) => arcId === targetArc.id)?.segments).toContainEqual({
			questId: authoredQuest.id,
			state: "current",
		})
		expect(result.rail.flatMap((arc) => arc.segments).filter((segment) => segment.state === "current")).toEqual([
			{ questId: authoredQuest.id, state: "current" },
		])
		expect({ season: baseSeason, quest }).toEqual(before)
	})

	it("gives draft with null points zero worth without inventing points", () => {
		const quest = { ...authoredQuest, points: null }
		expect(previewGame(baseSeason, quest, now).quest).toMatchObject({ points: null, worth: 0 })
	})

	it("whitelists map circles in previews without exposing place ids, distance or quest secrets", () => {
		const quest = {
			...authoredQuest,
			internalTitle: "internal title secret",
			adminNotes: "admin note secret",
			answers: ["answer secret"],
			hints: [{ ...authoredHint, text: "hint text secret" }],
			location: {
				guidance: "map" as const,
				places: [{ id: "secret-place", lat: 55.5, lng: 13.2, radius: 40, distance: 100 }],
			},
		}
		const before = structuredClone({ season: baseSeason, quest })
		const result = previewGame(baseSeason, quest, now)
		expect(result.quest).toEqual({
			...previewGame(baseSeason, { ...quest, location: null }, now).quest,
			location: { guidance: "map", places: [{ lat: 55.5, lng: 13.2, radius: 40 }] },
			hasAnswers: true,
		})
		for (const secret of [
			"internal title secret",
			"admin note secret",
			"answer secret",
			"hint text secret",
			"secret-place",
			"distance",
		]) {
			expect(JSON.stringify(result)).not.toContain(secret)
		}
		expect({ season: baseSeason, quest }).toEqual(before)
	})

	it.each(["none", "warmer"] as const)(
		"passes only %s guidance and backup-code presence through preview",
		(guidance) => {
			const quest = {
				...authoredQuest,
				answers: [],
				location: { guidance, places: [{ id: "secret-place", lat: 55.5, lng: 13.2, radius: 40 }] },
			}
			const before = structuredClone({ season: baseSeason, quest })
			const result = previewGame(baseSeason, quest, now)
			expect(result.quest).toMatchObject({
				location: { guidance },
				hasAnswers: false,
				assetPath: quest.assetPath,
			})
			expect(result.quest.location).toEqual({ guidance })
			for (const secret of ["places", "lat", "lng", "radius", "secret-place", "distance"]) {
				expect(JSON.stringify(result)).not.toContain(secret)
			}
			expect({ season: baseSeason, quest }).toEqual(before)
		},
	)
})
