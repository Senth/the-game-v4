import { beforeEach, describe, expect, it, vi } from "vitest"
import * as actions from "@/app/actions"
import { saveSeasonField } from "@/app/admin/autosave-actions"
import { getPuzzleTiles } from "@/lib/assets/puzzle-tiles"
import { requireAdmin, requireTeam } from "@/lib/auth/guards"
import { sessionOptions } from "@/lib/auth/session"
import { pieceIds, puzzleLocked } from "@/lib/domain/puzzle"
import { type Spot, Team } from "@/lib/domain/schemas"
import { newQuest } from "@/lib/domain/season-tree"
import { boardChannel, seasonChannel, subscribe, teamChannel } from "@/lib/events/bus"
import { dropPuzzlePiece, getSolvedPuzzle, loadGame, submitAnswer } from "@/lib/game/game"
import { useTestDb } from "@/test/db"
import * as database from "./collections"
import { collections } from "./collections"
import * as seasons from "./seasons"
import { createSeason, getSeason, removeQuest, setQuestAsset, setSeasonField } from "./seasons"
import * as structure from "./structural-writes"
import * as teams from "./teams"

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn(), requireTeam: vi.fn() }))
vi.mock("@/lib/assets/puzzle-tiles", () => ({ getPuzzleTiles: vi.fn(async () => ({ aspect: 1.5 })) }))

useTestDb()
const now = new Date()
const target = { arcId: "arc", questId: "quest", field: "puzzle" } as const
const puzzle = { rows: 2, cols: 2, showFull: false }
const quest = { ...newQuest(50), id: target.questId, assetPath: "/assets/puzzle.png", puzzle, answers: ["lamp"] }
let team: Team
let ids: string[]

beforeEach(async () => {
	vi.restoreAllMocks()
	vi.mocked(requireAdmin).mockResolvedValue({ _id: "admin", name: "Admin", passwordHash: "x" })
	const db = await collections()
	await db.teams.deleteMany({})
	await db.seasons.deleteMany({})
	await createSeason({
		_id: "season",
		title: "Puzzle",
		lengthMinutes: 60,
		start: new Date(now.getTime() - 1000),
		end: new Date(now.getTime() + 3_600_000),
		shuffleArcs: false,
		finisherBonuses: [20],
		arcs: [{ id: target.arcId, title: "Arc", shuffleQuests: false, quests: [quest] }],
	})
	team = await teams.createTeam({
		name: "Players",
		passwordHash: "x",
		seasonId: "season",
		questOrder: [quest.id],
		questIndex: 0,
		score: 0,
		completed: false,
		progress: [],
	})
	ids = await pieceIds(quest.id, quest.assetPath, 2, 2, sessionOptions().password)
	vi.mocked(requireTeam).mockImplementation(async () => (await teams.getTeam(team._id)) as Team)
})

async function state() {
	return (await teams.getTeam(team._id))?.progress[0]?.puzzle
}

async function setState(spots: Spot[]) {
	await teams.setTeamField(team._id, "progress", [
		{ questId: quest.id, hintsRevealed: [], pointsEarned: 0, puzzle: { version: 0, spots } },
	])
}

describe("shared puzzle writes", () => {
	it("initializes from current setup when edits race an unbuilt order's first load", async () => {
		await teams.setTeamField(team._id, "questOrder", [])
		const original = seasons.getSeason
		vi.spyOn(seasons, "getSeason").mockImplementationOnce(async (...args) => {
			const stale = await original(...args)
			await setSeasonField("season", target, { ...puzzle, rows: 3 })
			await setQuestAsset("season", target.arcId, quest.id, "/assets/replaced.png")
			return stale
		})
		const game = await loadGame((await teams.getTeam(team._id)) as Team, now)
		const currentIds = await pieceIds(quest.id, "/assets/replaced.png", 3, 2, sessionOptions().password)
		expect(game).toMatchObject({ quest: { puzzle: { rows: 3, cols: 2 } } })
		if (game.lifecycleState !== "running") throw new Error("Expected running puzzle")
		expect(game.quest?.puzzle?.pieces.map(({ id }) => id)).toEqual(currentIds.sort())
		expect((await state())?.spots).toHaveLength(6)
	})

	it("writes exactly one spread and returns the persisted board to concurrent loads", async () => {
		const initialize = vi.spyOn(teams, "ensurePuzzleState")
		const games = await Promise.all(Array.from({ length: 8 }, () => loadGame(team, now)))
		const stored = await state()
		expect(stored).toMatchObject({
			version: 0,
			spots: Array.from({ length: 4 }, () => ({ x: expect.any(Number), y: expect.any(Number) })),
		})
		for (const game of games) {
			expect(game).toEqual(games[0])
			expect(game).toMatchObject({ quest: { puzzle: { rows: 2, cols: 2, aspect: 1.5, fullUrl: null } } })
			expect(JSON.stringify(game)).not.toContain(quest.assetPath)
		}
		expect((await Promise.all(initialize.mock.results.map(({ value }) => value))).filter(Boolean)).toHaveLength(1)
		expect((await teams.getTeam(team._id))?.progress).toHaveLength(1)
		expect(Team.safeParse(await teams.getTeam(team._id)).success).toBe(true)
	})

	it("keeps both different-piece drops after a version conflict and publishes only to the team", async () => {
		await loadGame(team, now)
		const events: string[] = []
		const unsubscribe = subscribe([teamChannel(team._id), seasonChannel("season"), boardChannel], ({ channel }) =>
			events.push(channel),
		)
		const results = await Promise.all([
			dropPuzzlePiece(team, quest.id, ids[0] as string, { cell: 1 }, now),
			dropPuzzlePiece(team, quest.id, ids[1] as string, { cell: 0 }, now),
		])
		unsubscribe()
		expect(results).toEqual([{ status: "moved" }, { status: "moved" }])
		expect(await state()).toMatchObject({ version: 2, spots: [{ cell: 1 }, { cell: 0 }, {}, {}] })
		expect(events).toEqual([teamChannel(team._id), teamChannel(team._id)])
	})

	it("loads the new board when a typed solve races the first spread", async () => {
		const next = { ...quest, id: "next", assetPath: "/assets/next.png", puzzle: { ...puzzle, rows: 3 } }
		await setSeasonField("season", { arcId: target.arcId, field: "quests" }, [quest, next])
		await teams.setTeamField(team._id, "questOrder", [quest.id, next.id])
		vi.mocked(getPuzzleTiles).mockImplementationOnce(async () => {
			expect(await submitAnswer((await teams.getTeam(team._id)) as Team, quest.id, "lamp", now)).toMatchObject({
				ok: true,
				correct: true,
			})
			return { directory: "", aspect: 1.5 }
		})
		expect(await loadGame(team, now)).toMatchObject({
			quest: { id: next.id, puzzle: { rows: 3, pieces: expect.any(Array) } },
		})
	})

	it("retries a stale same-piece drop against the latest position, last write wins", async () => {
		await loadGame(team, now)
		const original = teams.writePuzzleDrop
		const write = vi.spyOn(teams, "writePuzzleDrop")
		let raced = false
		write.mockImplementation(async (...args) => {
			if (!raced) {
				raced = true
				await dropPuzzlePiece(team, quest.id, ids[0] as string, { cell: 2 }, now)
			}
			return original(...args)
		})
		expect(await dropPuzzlePiece(team, quest.id, ids[0] as string, { cell: 1 }, now)).toEqual({ status: "moved" })
		expect(await state()).toMatchObject({ version: 2, spots: [{ cell: 1 }, {}, {}, {}] })
	})

	it("solves once with stored hint penalties and one finisher claim under concurrent final drops", async () => {
		await setState([{ cell: 0 }, { cell: 1 }, { cell: 2 }, { x: 0, y: 0 }])
		const db = await collections()
		await db.teams.updateOne(
			{ _id: team._id },
			{ $push: { "progress.0.hintsRevealed": { hintId: "deleted", text: "Saved hint", points: 7, revealedAt: now } } },
		)
		const events: string[] = []
		const unsubscribe = subscribe([teamChannel(team._id), seasonChannel("season"), boardChannel], ({ channel }) =>
			events.push(channel),
		)
		const results = await Promise.all(
			Array.from({ length: 4 }, () => dropPuzzlePiece(team, quest.id, ids[3] as string, { cell: 3 }, now)),
		)
		unsubscribe()
		expect(results.filter(({ status }) => status === "solved")).toEqual([{ status: "solved", pointsEarned: 43 }])
		expect(await teams.getTeam(team._id)).toMatchObject({
			score: 63,
			questIndex: 1,
			completed: true,
			progress: [{ pointsEarned: 43, solvedAt: now }],
		})
		expect((await getSeason("season"))?.finishers).toEqual([{ teamId: team._id, place: 1, points: 20, at: now }])
		expect(events.filter((channel) => channel === boardChannel)).toHaveLength(1)
		expect(events.filter((channel) => channel === seasonChannel("season"))).toHaveLength(1)
		expect(await getSolvedPuzzle(team, quest.id)).toEqual({ ids, pointsEarned: 43 })
	})

	it("recalculates penalties when a hint is revealed between the final drop and solve", async () => {
		await setState([{ cell: 0 }, { cell: 1 }, { cell: 2 }, { x: 0, y: 0 }])
		const original = teams.solveCurrentQuest
		const solve = vi.spyOn(teams, "solveCurrentQuest")
		let revealed = false
		solve.mockImplementation(async (...args) => {
			if (!revealed) {
				revealed = true
				await teams.revealHint(
					team._id,
					{ questId: quest.id, questIndex: 0 },
					{ hintId: "hint", text: "Snapshot", points: 8, revealedAt: now },
				)
			}
			return original(...args)
		})
		expect(await dropPuzzlePiece(team, quest.id, ids[3] as string, { cell: 3 }, now)).toEqual({
			status: "solved",
			pointsEarned: 42,
		})
		expect(solve).toHaveBeenCalledTimes(2)
		expect((await teams.getTeam(team._id))?.score).toBe(62)
		await setSeasonField("season", { ...target, field: "points" }, 100)
		expect(await actions.getSolvedPuzzle(quest.id)).toEqual({ ids, pointsEarned: 42 })
	})

	it("never solves a board moved out of completion between the final drop and solve", async () => {
		await setState([{ cell: 0 }, { cell: 1 }, { cell: 2 }, { x: 0, y: 0 }])
		const original = teams.solveCurrentQuest
		const solve = vi.spyOn(teams, "solveCurrentQuest")
		solve.mockImplementationOnce(async (...args) => {
			await dropPuzzlePiece(team, quest.id, ids[0] as string, { x: 0.3, y: 0.7 }, now)
			return original(...args)
		})
		expect(await dropPuzzlePiece(team, quest.id, ids[3] as string, { cell: 3 }, now)).toEqual({ status: "moved" })
		expect(await teams.getTeam(team._id)).toMatchObject({ score: 0, completed: false, questIndex: 0 })
		expect((await getSeason("season"))?.finishers).toEqual([])
	})

	it("rejects ended play without a write", async () => {
		await loadGame(team, now)
		const before = await teams.getTeam(team._id)
		expect(
			await dropPuzzlePiece(team, quest.id, ids[0] as string, { cell: 0 }, new Date(now.getTime() + 3_600_000)),
		).toEqual({ status: "stale" })
		expect(await teams.getTeam(team._id)).toEqual(before)
	})

	it("keeps correct typed answers available and exposes solved cells only to the solving team", async () => {
		await loadGame(team, now)
		expect(await getSolvedPuzzle(team, quest.id)).toBeNull()
		expect(await submitAnswer(team, quest.id, "lamp", now)).toMatchObject({ ok: true, correct: true, pointsEarned: 50 })
		expect(await actions.getSolvedPuzzle(quest.id)).toEqual({ ids, pointsEarned: 50 })
		const other = await teams.createTeam({ ...team, _id: "other", name: "Other", questOrder: ["elsewhere"] })
		expect(await getSolvedPuzzle(other, quest.id)).toBeNull()
		expect(await dropPuzzlePiece(other, quest.id, ids[0] as string, { cell: 0 }, now)).toEqual({ status: "stale" })
		expect(await teams.getTeam(other._id)).toEqual(other)
	})

	it("rejects non-current quests, unknown ids and invalid targets without changing state", async () => {
		await loadGame(team, now)
		const before = await teams.getTeam(team._id)
		for (const [questId, pieceId, spot] of [
			["missing", ids[0], { cell: 0 }],
			[quest.id, "unknown", { cell: 0 }],
			[quest.id, ids[0], { cell: 4 }],
			[quest.id, ids[0], { x: -1, y: 0 }],
		] as const)
			expect(await dropPuzzlePiece(team, questId, pieceId as string, spot, now)).toEqual({ status: "stale" })
		expect(await teams.getTeam(team._id)).toEqual(before)
	})

	it("stops after three version retries", async () => {
		await loadGame(team, now)
		const write = vi.spyOn(teams, "writePuzzleDrop").mockResolvedValue(false)
		expect(await actions.dropPuzzlePiece(quest.id, ids[0] as string, { cell: 0 })).toEqual({ status: "stale" })
		expect(write).toHaveBeenCalledTimes(4)
	})

	it("guards both player actions before any reads or writes", async () => {
		vi.mocked(requireTeam).mockRejectedValue(new Error("Unauthorized"))
		await expect(actions.dropPuzzlePiece(quest.id, ids[0] as string, { cell: 0 })).rejects.toThrow("Unauthorized")
		await expect(actions.getSolvedPuzzle(quest.id)).rejects.toThrow("Unauthorized")
		expect(await teams.getTeam(team._id)).toEqual(team)
	})
})

describe("puzzle authoring locks", () => {
	describe.each(["initialization", "advancement", "skip"])("during %s", (reach) => {
		it.each(["dimensions", "mode", "replace", "remove"])(
			"serializes %s validation behind an in-flight reach",
			async (edit) => {
				if (reach === "initialization") {
					await teams.setTeamField(team._id, "questOrder", [])
				} else {
					await setSeasonField("season", { arcId: target.arcId, field: "quests" }, [
						{ ...newQuest(10), id: "first" },
						quest,
					])
					await teams.setTeamField(team._id, "questOrder", ["first", quest.id])
				}
				const db = await collections()
				vi.spyOn(database, "collections").mockResolvedValue(db)
				const started = Promise.withResolvers<void>()
				const resume = Promise.withResolvers<void>()
				if (reach === "initialization") {
					const originalWrite = db.teams.bulkWrite.bind(db.teams)
					vi.spyOn(db.teams, "bulkWrite").mockImplementationOnce(async (...args) => {
						started.resolve()
						await resume.promise
						return originalWrite(...args)
					})
				} else {
					const originalWrite = db.teams.updateOne.bind(db.teams)
					vi.spyOn(db.teams, "updateOne").mockImplementation(async (...args) => {
						if ("$inc" in args[1] || ("$set" in args[1] && args[1].$set?.questOrder)) {
							started.resolve()
							await resume.promise
						}
						return originalWrite(...args)
					})
				}
				const season = await getSeason("season")
				if (!season) throw new Error("Missing puzzle season")
				const initialization =
					reach === "initialization"
						? teams.fillQuestOrders(season, [(await teams.getTeam(team._id)) as Team])
						: reach === "skip"
							? removeQuest("season", target.arcId, "first", now)
							: teams.solveCurrentQuest(
									team._id,
									{ questId: "first", questIndex: 0, orderLength: 2, hintCount: 0 },
									now,
									10,
								)
				await started.promise
				const queued = Promise.withResolvers<string>()
				const originalLock = structure.withSeasonStructure
				vi.spyOn(structure, "withSeasonStructure").mockImplementation((...args) => {
					queued.resolve("queued")
					return originalLock(...args)
				})
				const mutation =
					edit === "replace" || edit === "remove"
						? setQuestAsset("season", target.arcId, quest.id, edit === "remove" ? null : "/assets/new.png")
						: setSeasonField("season", target, edit === "mode" ? null : { ...puzzle, rows: 3 })
				const outcome = mutation.then(
					() => "edited",
					() => "rejected",
				)
				try {
					expect(await Promise.race([queued.promise, outcome])).toBe("queued")
				} finally {
					resume.resolve()
					await initialization
					await outcome
				}
				await expect(mutation).rejects.toThrow("Locked: a team has reached this puzzle.")
				expect((await getSeason("season"))?.arcs[0]?.quests.find((entry) => entry.id === quest.id)).toEqual(quest)
			},
		)
	})

	it("counts each reached team once, rejects mode and dimension edits, allows showFull", async () => {
		await loadGame(team, now)
		expect(puzzleLocked({ _id: "season" }, await teams.listTeams("season"), quest.id)).toBe(1)
		for (const value of [null, { ...puzzle, rows: 3 }, { ...puzzle, cols: 3 }]) {
			expect(await saveSeasonField("season", target, value)).toEqual({
				ok: false,
				error: "Locked: a team has reached this puzzle.",
			})
		}
		expect(await saveSeasonField("season", target, { ...puzzle, showFull: true })).toEqual({ ok: true })
		expect(await loadGame(team, now)).toMatchObject({ quest: { puzzle: { fullUrl: `/api/puzzle/${quest.id}/full` } } })
		await expect(setQuestAsset("season", target.arcId, quest.id, "/assets/new.png")).rejects.toThrow(
			"Locked: a team has reached this puzzle.",
		)
		await expect(setQuestAsset("season", target.arcId, quest.id, null)).rejects.toThrow(
			"Locked: a team has reached this puzzle.",
		)
	})

	it("counts current quests without progress and historic reached quests, not future quests", async () => {
		const history = { questId: quest.id, hintsRevealed: [], pointsEarned: 0 }
		await teams.createTeam({ ...team, _id: "past", name: "Past", questIndex: 1, progress: [history] })
		await teams.createTeam({ ...team, _id: "future", name: "Future", questOrder: ["first", quest.id] })
		expect(puzzleLocked({ _id: "season" }, await teams.listTeams("season"), quest.id)).toBe(2)
		await expect(setSeasonField("season", target, null)).rejects.toThrow("Locked: a team has reached this puzzle.")
	})

	it("validates dimensions and image eligibility, rejects non-image Replace, clears mode on Remove", async () => {
		await teams.setTeamField(team._id, "questOrder", ["first", quest.id])
		for (const rows of [1, 8, 2.5])
			expect((await saveSeasonField("season", target, { ...puzzle, rows })).ok).toBe(false)
		await expect(setQuestAsset("season", target.arcId, quest.id, "/assets/new.pdf")).rejects.toThrow(
			"Puzzle mode requires an image.",
		)
		await setQuestAsset("season", target.arcId, quest.id, null)
		expect((await getSeason("season"))?.arcs[0]?.quests[0]).toMatchObject({ assetPath: null, puzzle: null })
		expect(await saveSeasonField("season", target, puzzle)).toEqual({
			ok: false,
			error: "Puzzle mode requires an image.",
		})
		await setQuestAsset("season", target.arcId, quest.id, "/assets/new.svg")
		expect(await saveSeasonField("season", target, puzzle)).toEqual({ ok: true })
	})
})
