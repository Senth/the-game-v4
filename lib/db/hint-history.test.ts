import { describe, expect, it } from "vitest"
import type { Quest } from "@/lib/domain/schemas"
import { hintPenalty } from "@/lib/domain/scoring"
import { useTestDb } from "@/test/db"
import { NotFoundError } from "./collections"
import { createSeason, setSeasonField } from "./seasons"
import { createTeam, getTeam, recordSolve, revealHint } from "./teams"

useTestDb()

const quest: Quest = {
	id: "q1",
	displayTitle: "Beacon",
	internalTitle: "beacon",
	content: "Decode the light",
	assetPath: null,
	answers: ["lamp"],
	points: 50,
	adminNotes: "",
	hints: [
		{ id: "h1", text: "Count the flashes", points: 5 },
		{ id: "h2", text: "Morse", points: 10 },
	],
}

async function setup() {
	const season = await createSeason({
		title: "Cipher Night",
		lengthMinutes: 120,
		start: null,
		end: null,
		shuffleArcs: false,
		arcs: [{ id: "a1", title: "Lighthouse", shuffleQuests: false, quests: [quest] }],
	})
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
	return { seasonId: season._id, teamId: team._id }
}

function snapshot(index: 0 | 1, revealedAt: Date) {
	const hint = quest.hints[index]
	if (!hint) throw new Error("fixture")
	return { hintId: hint.id, text: hint.text, points: hint.points, revealedAt }
}

async function editAndDeleteHints(seasonId: string) {
	const target = { arcId: "a1", questId: "q1" }
	await setSeasonField(seasonId, { ...target, hintId: "h1", field: "text" }, "Rewritten")
	await setSeasonField(seasonId, { ...target, hintId: "h1", field: "points" }, 20)
	await setSeasonField(seasonId, { ...target, field: "hints" }, [
		{ id: "h2", text: "Morse", points: 10 },
		{ id: "h1", text: "Rewritten", points: 20 },
	])
	await setSeasonField(seasonId, { ...target, field: "hints" }, [{ id: "h1", text: "Rewritten", points: 20 }])
}

describe("revealed-hint history", () => {
	it("keeps snapshots and score through hint edits, reorder, deletion and solve", async () => {
		const { seasonId, teamId } = await setup()
		const snapshots = [snapshot(0, new Date("2026-03-14T18:05:00Z")), snapshot(1, new Date("2026-03-14T18:09:00Z"))]
		for (const revealed of snapshots) await revealHint(teamId, "q1", revealed)

		await editAndDeleteHints(seasonId)
		expect((await getTeam(teamId))?.progress).toEqual([{ questId: "q1", hintsRevealed: snapshots, pointsEarned: 0 }])

		const solvedAt = new Date("2026-03-14T18:12:00Z")
		await recordSolve(teamId, "q1", solvedAt, 50 - hintPenalty(snapshots))
		const solved = {
			_id: teamId,
			score: 35,
			progress: [{ questId: "q1", solvedAt, hintsRevealed: snapshots, pointsEarned: 35 }],
		}
		expect(await getTeam(teamId)).toMatchObject(solved)

		await editAndDeleteHints(seasonId)
		await setSeasonField(seasonId, { arcId: "a1", questId: "q1", field: "hints" }, [])
		await recordSolve(teamId, "q1", new Date(), 50)
		expect(await getTeam(teamId)).toMatchObject(solved)
	})

	it("stores one snapshot for repeated and concurrent reveals of the same hint", async () => {
		const { teamId } = await setup()
		const first = snapshot(0, new Date("2026-03-14T18:05:00Z"))
		await Promise.all([revealHint(teamId, "q1", first), revealHint(teamId, "q1", first)])
		await revealHint(teamId, "q1", snapshot(0, new Date("2026-03-14T18:06:00Z")))
		await revealHint(teamId, "q1", snapshot(1, new Date()))

		const progress = (await getTeam(teamId))?.progress
		expect(progress).toHaveLength(1)
		expect(progress?.[0]?.hintsRevealed.map((s) => s.hintId)).toEqual(["h1", "h2"])
		expect(progress?.[0]?.hintsRevealed[0]).toEqual(first)
	})

	it("rejects invalid writes and leaves the team unchanged", async () => {
		const { teamId } = await setup()
		await revealHint(teamId, "q1", snapshot(0, new Date("2026-03-14T18:05:00Z")))
		const before = await getTeam(teamId)

		await expect(recordSolve(teamId, "q1", new Date(), Number.NaN)).rejects.toThrow()
		await expect(recordSolve(teamId, "q1", new Date("invalid"), 50)).rejects.toThrow()
		await expect(recordSolve(teamId, "", new Date(), 50)).rejects.toThrow()
		await expect(revealHint(teamId, "", snapshot(1, new Date()))).rejects.toThrow()
		expect(await getTeam(teamId)).toEqual(before)
	})

	it("throws for a missing team", async () => {
		await expect(revealHint("missing", "q1", snapshot(0, new Date()))).rejects.toThrow(NotFoundError)
	})
})
