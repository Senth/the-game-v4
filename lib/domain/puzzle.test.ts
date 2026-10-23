import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { buildFixture } from "@/scripts/fixture"
import { dropPiece, isSolved, pieceIds, puzzleLocked, randomSpread, snapCell } from "./puzzle"
import { Puzzle, PuzzleState, Quest, Spot, TeamQuestProgress } from "./schemas"

describe("puzzle schemas", () => {
	it("defaults puzzle configuration and keeps legacy quests and progress readable", () => {
		expect(Puzzle.parse({})).toEqual({ rows: 4, cols: 4, showFull: false })
		const quest = buildFixture(new Date()).season.arcs[0]?.quests[0]
		expect(Quest.parse(quest).puzzle).toBeNull()
		expect(TeamQuestProgress.parse({ questId: "q", hintsRevealed: [], pointsEarned: 0 })).not.toHaveProperty("puzzle")
	})

	it.each([2, 4, 7])("accepts dimension %i", (dimension) => {
		expect(Puzzle.parse({ rows: dimension, cols: dimension, showFull: true })).toEqual({
			rows: dimension,
			cols: dimension,
			showFull: true,
		})
	})

	it.each([1, 8, 2.5, "4", null, Number.NaN, Number.POSITIVE_INFINITY])("rejects dimension %j", (dimension) => {
		for (const field of ["rows", "cols"]) expect(Puzzle.safeParse({ [field]: dimension }).success).toBe(false)
	})

	it.each([{ cell: 0 }, { cell: 48 }, { x: 0, y: 1 }, { x: 0.5, y: 0.5 }])("accepts spot %j", (spot) => {
		expect(Spot.parse(spot)).toEqual(spot)
	})

	it.each([
		{ cell: -1 },
		{ cell: 49 },
		{ cell: 0.5 },
		{ x: -0.1, y: 0 },
		{ x: 0, y: 1.1 },
		{ x: Number.NaN, y: 0 },
		{ x: 0 },
		{ cell: 0, x: 0, y: 0 },
	])("rejects spot %j", (spot) => {
		expect(Spot.safeParse(spot).success).toBe(false)
	})

	it("validates board versions, occupied cells and piece count", () => {
		const state = { version: 0, spots: [{ cell: 0 }, { cell: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }] }
		expect(PuzzleState.parse(state)).toEqual(state)
		for (const version of [-1, 0.5, "0"]) expect(PuzzleState.safeParse({ ...state, version }).success).toBe(false)
		for (const spots of [
			[],
			state.spots.slice(1),
			Array(50).fill({ x: 0, y: 0 }),
			[{ cell: 0 }, { cell: 0 }, { cell: 2 }, { cell: 3 }],
			[{ cell: 0 }, { cell: 1 }, { cell: 2 }, { cell: 4 }],
		])
			expect(PuzzleState.safeParse({ version: 0, spots }).success).toBe(false)
		expect(TeamQuestProgress.parse({ questId: "q", hintsRevealed: [], pointsEarned: 0, puzzle: state }).puzzle).toEqual(
			state,
		)
	})
})

describe("puzzle moves", () => {
	it.each([
		[0, 0, 0],
		[0.249999, 0, 0],
		[0.25, 0, 1],
		[0.250001, 0, 1],
		[0, 0.499999, 0],
		[0, 0.5, 4],
		[1, 1, 7],
		[-0.1, 1.1, 4],
	])("snaps normalized frame position (%f, %f) to cell %i", (x, y, cell) => {
		expect(snapCell(2, 4, x, y)).toEqual({ cell })
	})

	it("swaps occupants back to frame or tray origins without mutating inputs", () => {
		for (const origin of [{ cell: 0 }, { x: 0.2, y: 0.8 }]) {
			const state = { version: 3, spots: [origin, { cell: 1 }, { x: 0, y: 0 }, { cell: 3 }] }
			const before = structuredClone(state)
			expect(dropPiece(state, 0, { cell: 1 })).toEqual({
				version: 4,
				spots: [{ cell: 1 }, origin, { x: 0, y: 0 }, { cell: 3 }],
			})
			expect(state).toEqual(before)
		}
	})

	it("keeps loose coordinates, allows overlap and places pieces in empty cells", () => {
		const state = { version: 0, spots: [{ cell: 0 }, { cell: 1 }, { x: 0.3, y: 0.7 }, { cell: 3 }] }
		const loose = dropPiece(state, 0, { x: 0.3, y: 0.7 })
		expect(loose.spots).toEqual([{ x: 0.3, y: 0.7 }, ...state.spots.slice(1)])
		expect(dropPiece(loose, 2, { cell: 2 }).spots[2]).toEqual({ cell: 2 })
		expect(dropPiece(state, 1, { cell: 1 }).spots).toEqual(state.spots)
	})

	it("rejects invalid piece indexes and target spots", () => {
		const state = { version: 0, spots: randomSpread(4, () => 0.5) }
		for (const index of [-1, 4, 0.5]) expect(() => dropPiece(state, index, { cell: 0 })).toThrow()
		for (const target of [{ cell: 4 }, { x: -0.1, y: 0 }]) expect(() => dropPiece(state, 0, target)).toThrow()
	})

	it("solves only nonempty boards with every piece in its correct cell", () => {
		const state = { version: 4, spots: Array.from({ length: 4 }, (_, cell) => ({ cell })) }
		expect(isSolved(state)).toBe(true)
		expect(isSolved({ version: 0, spots: [] })).toBe(false)
		expect(isSolved(dropPiece(state, 0, { cell: 1 }))).toBe(false)
		expect(isSolved(dropPiece(state, 3, { x: 1, y: 1 }))).toBe(false)
	})

	it("spreads every piece loose and never solved over 10,000 runs", () => {
		for (let run = 0; run < 10_000; run++) {
			const spots = randomSpread(4 + (run % 46), Math.random)
			expect(spots).toHaveLength(4 + (run % 46))
			expect(spots.every((spot) => "x" in spot && Spot.safeParse(spot).success)).toBe(true)
			expect(isSolved({ version: 0, spots })).toBe(false)
		}
		expect(randomSpread(4, () => 0.25)).toEqual(Array(4).fill({ x: 0.25, y: 0.25 }))
	})
})

describe("pieceIds", () => {
	it("uses exact HMAC construction with stable, unique, opaque ids for each setup", async () => {
		const ids = await pieceIds("quest", "/assets/private.png", 7, 7, "secret")
		expect(ids).toEqual(await pieceIds("quest", "/assets/private.png", 7, 7, "secret"))
		expect(new Set(ids).size).toBe(49)
		for (const [index, id] of ids.entries()) {
			expect(id).toBe(
				createHmac("sha256", "secret")
					.update(`quest:/assets/private.png:7x7:${index}`)
					.digest("base64url")
					.slice(0, 16),
			)
			expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/)
		}
		for (const [questId, assetPath, rows, cols, secret] of [
			["other", "/assets/private.png", 7, 7, "secret"],
			["quest", "/assets/other.png", 7, 7, "secret"],
			["quest", "/assets/private.png", 6, 7, "secret"],
			["quest", "/assets/private.png", 7, 6, "secret"],
			["quest", "/assets/private.png", 7, 7, "other"],
		] as const)
			expect((await pieceIds(questId, assetPath, rows, cols, secret))[0]).not.toBe(ids[0])
	})
})

it("counts each reached team once, scoped to season and quest", () => {
	const { season, teams } = buildFixture(new Date())
	const base = teams[0]
	if (!base) throw new Error("Fixture team missing")
	const current = { ...base, questOrder: ["puzzle"], questIndex: 0, progress: [] }
	const reached = { questId: "puzzle", hintsRevealed: [], pointsEarned: 0 }
	const candidates = [
		current,
		{ ...current, progress: [reached] },
		{ ...current, questIndex: 1, progress: [reached] },
		{ ...current, questIndex: 1 },
		{ ...current, questOrder: [] },
		{ ...current, seasonId: "other" },
	]
	const before = structuredClone(candidates)
	expect(puzzleLocked(season, candidates, "puzzle")).toBe(3)
	expect(puzzleLocked(season, candidates, "missing")).toBe(0)
	expect(candidates).toEqual(before)
})
