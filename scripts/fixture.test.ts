import { describe, expect, it } from "vitest"
import { rankTeams } from "@/lib/domain/game"
import { playerGame } from "@/lib/domain/player-game"
import { Admin, Puzzle, PuzzleState, Quest, Season, Team } from "@/lib/domain/schemas"
import { hintPenalty } from "@/lib/domain/scoring"
import { buildFixture } from "./fixture"

const now = new Date("2026-10-05T19:12:30Z")
const { season, teams, admins } = buildFixture(now)
const arcIds = season.arcs.map((arc) => arc.quests.map((quest) => quest.id))
const authored = arcIds.flat()
const finaleIds = arcIds[2] ?? []
const quests = new Map(season.arcs.flatMap((arc) => arc.quests.map((quest) => [quest.id, quest] as const)))

const standings: [string, number, number][] = [
	["Rävarna", 9, 120],
	["Team Kaos", 8, 105],
	["Fjällräv", 8, 98],
	["Byggarna", 7, 90],
	["Glada Gänget", 7, 82],
	["Lagom", 6, 70],
	["Ninjas", 5, 64],
	["Kodknäckarna", 4, 50],
	["Sista Laget", 4, 41],
	["Lösenord123", 2, 20],
]

describe("buildFixture", () => {
	it("passes the Season, Team and Admin schemas", () => {
		expect(season.finisherBonuses).toEqual([50, 20])
		expect(season.finishers).toEqual([])
		expect(() => Season.parse(season)).not.toThrow()
		for (const { password, ...team } of teams)
			expect(() => Team.parse({ ...team, passwordHash: password })).not.toThrow()
		for (const { password, ...admin } of admins)
			expect(() => Admin.parse({ ...admin, passwordHash: password })).not.toThrow()
		expect(admins).toEqual([{ _id: "admin", name: "admin", password: "admin" }])
	})

	it("orders every team through all quests and keeps Finale order", () => {
		for (const team of teams) {
			expect([...team.questOrder].sort()).toEqual([...authored].sort())
			expect(team.questOrder).not.toEqual(authored)
			expect(team.questOrder.filter((questId) => finaleIds.includes(questId))).toEqual(finaleIds)
		}
	})

	it("matches the S1 standings with scores that follow the scoring formula", () => {
		expect(teams.map((team) => [team.name, team.questIndex, team.score])).toEqual(standings)
		expect(rankTeams(teams).map((team) => team.name)).toEqual(standings.map(([name]) => name))
		for (const team of teams) {
			const solved = team.progress.filter((entry) => entry.solvedAt)
			expect(solved).toHaveLength(team.questIndex)
			expect(team.score).toBe(solved.reduce((sum, entry) => sum + entry.pointsEarned, 0))
			for (const entry of solved) {
				expect(entry.pointsEarned).toBe((quests.get(entry.questId)?.points ?? 0) - hintPenalty(entry.hintsRevealed))
			}
			for (const entry of team.progress) {
				for (const time of [entry.solvedAt, ...entry.hintsRevealed.map((snapshot) => snapshot.revealedAt)]) {
					if (!time) continue
					expect(time.getTime()).toBeGreaterThan(season.start?.getTime() ?? Number.NaN)
					expect(time.getTime()).toBeLessThan(now.getTime())
				}
			}
		}
	})

	it("keeps Lagom's skipped quest and charged deleted hint in history", () => {
		const lagom = teams.find((team) => team.name === "Lagom")
		if (!lagom) throw new Error("fixture")
		const removed = lagom.progress.filter((entry) => !quests.has(entry.questId))
		expect(removed).toHaveLength(1)
		expect(removed[0]).toMatchObject({ pointsEarned: 0, hintsRevealed: [{ points: 5 }] })
		expect(removed[0]?.solvedAt).toBeUndefined()
		expect(lagom.questOrder).not.toContain(removed[0]?.questId)
		expect(removed[0]?.hintsRevealed[0]?.text).toBeTruthy()

		const solved = lagom.progress.find((entry) => entry.questId === "backwards-log")
		expect(solved?.solvedAt).toBeInstanceOf(Date)
		expect(solved?.hintsRevealed).toEqual([
			expect.objectContaining({ hintId: "backwards-log-deleted-hint", text: "Start from the bottom.", points: 5 }),
		])
		expect(quests.get("backwards-log")?.hints.map((hint) => hint.id)).not.toContain(solved?.hintsRevealed[0]?.hintId)
		expect(solved?.pointsEarned).toBe(15)
		expect(lagom.score).toBe(70)
	})

	it("keeps Ninjas mid-game on Backwards log, three behind pace", () => {
		const ninjas = teams.find((team) => team.name === "Ninjas")
		if (!ninjas || !season.start || !season.end) throw new Error("fixture")
		expect(ninjas.password).toBe("ninjas")
		expect(new Set(ninjas.questOrder.slice(0, 5))).toEqual(
			new Set(["church-bells", "cobblestones", "bakers-riddle", "clock-tower", "harbour-map"]),
		)
		expect(ninjas.questOrder[ninjas.questIndex]).toBe("backwards-log")
		const current = ninjas.progress.find((entry) => entry.questId === "backwards-log")
		expect(current?.solvedAt).toBeUndefined()
		expect(current?.hintsRevealed.map((snapshot) => snapshot.hintId)).toEqual(["backwards-log-h1"])
		expect(ninjas.reachedAt).toEqual(new Date(now.getTime() - 15 * 60_000))
		expect(quests.get("backwards-log")?.drop).toEqual({ fullMinutes: 10, dropMinutes: 20, floor: 5 })
		const view = playerGame(season, ninjas, teams, now)
		if (view.lifecycleState !== "running") throw new Error("fixture")
		expect(view.quest).toMatchObject({
			points: 20,
			drop: { fullMinutes: 10, dropMinutes: 20, floor: 5, reachedAt: ninjas.reachedAt?.getTime() },
			hintPenalty: 5,
			worth: 12,
		})

		const timeFraction = (now.getTime() - season.start.getTime()) / (season.end.getTime() - season.start.getTime())
		const behindPercent = 100 * timeFraction - (100 * ninjas.questIndex) / authored.length
		expect(Math.round(timeFraction * authored.length) - ninjas.questIndex).toBe(3)
		expect(behindPercent).toBeGreaterThan(20)
	})

	it("seeds Gather the pieces as a puzzle and Rävarna halfway through it", () => {
		const puzzleQuest = quests.get("gather-the-pieces")
		if (!puzzleQuest) throw new Error("fixture")
		expect(Puzzle.parse(puzzleQuest.puzzle)).toEqual({ rows: 4, cols: 4, showFull: false })
		expect(puzzleQuest.assetPath).toMatch(/^\/assets\/[0-9a-f-]{36}\.png$/)
		expect(puzzleQuest.answers).toEqual([])
		expect(puzzleQuest.points).toBe(15)
		expect(puzzleQuest.hints.map(({ text, points }) => [text, points])).toEqual([
			["Fog horn morse gave you SOS.", 3],
			["Three letters, one word.", 5],
		])

		const ravarna = teams.find((team) => team.name === "Rävarna")
		if (!ravarna) throw new Error("fixture")
		const state = PuzzleState.parse(ravarna.progress.find((entry) => entry.questId === puzzleQuest.id)?.puzzle)
		expect(ravarna.questOrder[ravarna.questIndex]).toBe("gather-the-pieces")
		expect(state.spots.filter((spot) => "cell" in spot)).toHaveLength(8)
		expect(state.spots.filter((spot, index) => "cell" in spot && spot.cell !== index)).toHaveLength(2)
		expect(state.spots.filter((spot) => !("cell" in spot))).toHaveLength(8)
	})

	it("adds both unsolved location quests without changing standings", () => {
		const locationQuest = quests.get("svedala-station")
		const threeCorners = quests.get("three-corners")
		if (!locationQuest || !threeCorners) throw new Error("fixture")
		expect(season.placeRadius).toBe(40)
		expect(locationQuest).toMatchObject({
			internalTitle: "Svedala station",
			displayTitle: "Next stop",
			content: "Trains to Malmö stop here twice an hour. Stand where the tickets are sold and the quest is yours.",
			assetPath: null,
			answers: [],
			points: 20,
			hints: [{ text: "Look for the yellow ticket machine.", points: 5 }],
			location: {
				guidance: "warmer",
				places: [{ id: "svedala-station-place", lat: 55.50682, lng: 13.23289, radius: 40 }],
			},
		})
		expect(() => Quest.parse(threeCorners)).not.toThrow()
		expect(threeCorners).toMatchObject({
			internalTitle: "Three corners",
			displayTitle: "Three corners",
			content:
				"The old town was laid out from three stones. Stand on all three at once and the town will tell you where to go next.\n\nSplit up. Each circle needs one of you inside it.",
			assetPath: null,
			answers: [],
			points: 25,
			hints: [],
			location: {
				guidance: "map",
				places: [
					{ id: "three-corners-place-1", lat: 55.5074, lng: 13.2346, radius: 35 },
					{ id: "three-corners-place-2", lat: 55.50793, lng: 13.235, radius: 38 },
					{ id: "three-corners-place-3", lat: 55.50728, lng: 13.23548, radius: 40 },
				],
			},
		})
		expect(authored).toHaveLength(14)
		for (const team of teams) {
			expect(team.questOrder).toHaveLength(14)
			expect(team.questOrder).toContain(locationQuest.id)
			expect(team.progress.find((entry) => entry.questId === locationQuest.id)?.solvedAt).toBeUndefined()
			if (team.name === "Byggarna" || team.name === "Team Kaos") {
				expect(team.questOrder.indexOf(threeCorners.id)).toBeLessThan(team.questOrder.indexOf(locationQuest.id))
			} else {
				expect(team.questOrder.indexOf(locationQuest.id)).toBeLessThan(team.questOrder.indexOf(threeCorners.id))
			}
			expect(team.progress.find((entry) => entry.questId === threeCorners.id)?.solvedAt).toBeUndefined()
		}
		for (const [name, questId] of [
			["Byggarna", "three-corners"],
			["Team Kaos", "three-corners"],
			["Lagom", "svedala-station"],
		] as const) {
			const team = teams.find((candidate) => candidate.name === name)
			expect(team?.questOrder[team.questIndex]).toBe(questId)
		}
		expect(teams.map((team) => [team.name, team.questIndex, team.score])).toEqual(standings)

		const ninjas = teams.find((team) => team.name === "Ninjas")
		if (!ninjas) throw new Error("fixture")
		expect(ninjas.questOrder[ninjas.questIndex]).toBe("backwards-log")
		expect(ninjas.questOrder[ninjas.questIndex + 1]).toBe(locationQuest.id)
		expect(ninjas.questOrder[ninjas.questIndex + 2]).toBe(threeCorners.id)
	})

	it("describes Backwards log as the G2 mock does", () => {
		const backwardsLog = quests.get("backwards-log")
		expect(backwardsLog).toMatchObject({ displayTitle: "The keeper's last log", answers: ["lighthouse", "fyren"] })
		expect(backwardsLog?.hints.map((hint) => hint.points)).toEqual([5, 10, 20])
		expect(backwardsLog?.assetPath).toMatch(/^\/assets\/[0-9a-f-]{36}\.png$/)
	})
})
