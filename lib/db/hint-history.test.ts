import { describe, expect, it } from "vitest"
import type { Quest } from "@/lib/domain/schemas"
import { hintPenalty } from "@/lib/domain/scoring"
import { useTestDb } from "@/test/db"
import { NotFoundError } from "./collections"
import { createSeason, setSeasonField } from "./seasons"
import { createTeam, getTeam, revealHint, solveCurrentQuest } from "./teams"

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

const current = { questIndex: 0, questId: "q1" }
const solveQ1 = { ...current, orderLength: 1, hintCount: 2 }

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
		for (const revealed of snapshots) await revealHint(teamId, current, revealed)

		await editAndDeleteHints(seasonId)
		expect((await getTeam(teamId))?.progress).toEqual([{ questId: "q1", hintsRevealed: snapshots, pointsEarned: 0 }])

		const solvedAt = new Date("2026-03-14T18:12:00Z")
		expect(await solveCurrentQuest(teamId, solveQ1, solvedAt, 50 - hintPenalty(snapshots))).toBe(true)
		const solved = {
			_id: teamId,
			score: 35,
			questIndex: 1,
			completed: true,
			progress: [{ questId: "q1", solvedAt, hintsRevealed: snapshots, pointsEarned: 35 }],
		}
		expect(await getTeam(teamId)).toMatchObject(solved)

		await editAndDeleteHints(seasonId)
		await setSeasonField(seasonId, { arcId: "a1", questId: "q1", field: "hints" }, [])
		expect(await solveCurrentQuest(teamId, solveQ1, new Date(), 50)).toBe(false)
		expect(await getTeam(teamId)).toMatchObject(solved)
	})

	it("stores one snapshot for repeated and concurrent reveals of the same hint", async () => {
		const { teamId } = await setup()
		const first = snapshot(0, new Date("2026-03-14T18:05:00Z"))
		const appended = await Promise.all([revealHint(teamId, current, first), revealHint(teamId, current, first)])
		expect(appended.sort()).toEqual([false, true])
		await revealHint(teamId, current, snapshot(0, new Date("2026-03-14T18:06:00Z")))
		await revealHint(teamId, current, snapshot(1, new Date()))

		const progress = (await getTeam(teamId))?.progress
		expect(progress).toHaveLength(1)
		expect(progress?.[0]?.hintsRevealed.map((s) => s.hintId)).toEqual(["h1", "h2"])
		expect(progress?.[0]?.hintsRevealed[0]).toEqual(first)
	})

	it("rejects invalid writes and leaves the team unchanged", async () => {
		const { teamId } = await setup()
		await revealHint(teamId, current, snapshot(0, new Date("2026-03-14T18:05:00Z")))
		const before = await getTeam(teamId)

		const solveOne = { ...current, orderLength: 1, hintCount: 1 }
		await expect(solveCurrentQuest(teamId, solveOne, new Date(), Number.NaN)).rejects.toThrow()
		await expect(solveCurrentQuest(teamId, solveOne, new Date("invalid"), 50)).rejects.toThrow()
		await expect(solveCurrentQuest(teamId, { ...solveOne, questId: "" }, new Date(), 50)).rejects.toThrow()
		await expect(solveCurrentQuest(teamId, { ...solveOne, orderLength: 0 }, new Date(), 50)).rejects.toThrow()
		await expect(revealHint(teamId, { questIndex: 0, questId: "" }, snapshot(1, new Date()))).rejects.toThrow()
		expect(await getTeam(teamId)).toEqual(before)
	})

	it("throws for a missing team", async () => {
		await expect(revealHint("missing", current, snapshot(0, new Date()))).rejects.toThrow(NotFoundError)
	})
})
