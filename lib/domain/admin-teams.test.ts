import { describe, expect, it } from "vitest"
import { adminTeamRows } from "./admin-teams"
import { currentQuest } from "./game"
import { Arc, Quest, Season, Team } from "./schemas"

const start = new Date("2026-03-14T18:00:00Z")
const end = new Date("2026-03-14T19:00:00Z")
const now = new Date("2026-03-14T18:30:00Z")
const season = Season.parse({
	_id: "season",
	title: "Cipher Night",
	lengthMinutes: 60,
	start,
	end,
	shuffleArcs: true,
	arcs: [
		Arc.parse({
			id: "a1",
			title: "Lighthouse",
			shuffleQuests: true,
			quests: [
				Quest.parse({
					id: "q1",
					displayTitle: "Player title",
					internalTitle: "Admin title",
					content: "",
					assetPath: null,
					answers: [],
					points: 30,
					adminNotes: "",
					hints: [],
				}),
				Quest.parse({
					id: "q2",
					displayTitle: "Display only",
					internalTitle: "",
					content: "",
					assetPath: null,
					answers: [],
					points: 30,
					adminNotes: "",
					hints: [],
				}),
			],
		}),
		{ id: "a2", title: "Finale", shuffleQuests: false, quests: [] },
	],
})

const team = (overrides: Partial<Team> = {}): Team =>
	Team.parse({
		_id: "ninjas",
		name: "Ninjas",
		passwordHash: "secret",
		seasonId: season._id,
		questOrder: ["q2", "q1"],
		questIndex: 1,
		score: 25,
		completed: false,
		progress: [
			{
				questId: "q2",
				solvedAt: start,
				pointsEarned: 25,
				hintsRevealed: [{ hintId: "deleted", text: "Old hint", points: 5, revealedAt: start }],
			},
			{
				questId: "q1",
				pointsEarned: 0,
				hintsRevealed: [{ hintId: "current", text: "Current hint", points: 10, revealedAt: now }],
			},
		],
		...overrides,
	})

describe("adminTeamRows", () => {
	it("shows admin labels, all hint loss and authored rails with every team's current quest", () => {
		const teams = [team(), team({ _id: "other", name: "Other" })]
		const original = structuredClone({ season, teams })
		const rows = adminTeamRows(season, teams, now)
		expect(rows[0]).toEqual({
			id: "ninjas",
			name: "Ninjas",
			score: 25,
			hintLoss: 15,
			rank: 1,
			rail: [
				{
					arcId: "a1",
					segments: [
						{ questId: "q1", state: "current" },
						{ questId: "q2", state: "solved" },
					],
				},
				{ arcId: "a2", segments: [] },
			],
			status: { kind: "on", quest: "Admin title" },
		})
		expect(rows[1]?.rail).toEqual(rows[0]?.rail)
		expect({ season, teams }).toEqual(original)
	})

	it("ranks 1, 2, 2, 4 and orders tied teams by latest solve before name", () => {
		const teams = [
			team({ _id: "last", score: -5 }),
			team({
				_id: "late",
				name: "Alpha",
				score: 20,
				progress: [{ questId: "q2", solvedAt: now, pointsEarned: 20, hintsRevealed: [] }],
			}),
			team({ _id: "first", score: 50 }),
			team({ _id: "early", name: "Zulu", score: 20 }),
		]
		expect(adminTeamRows(season, teams, now).map(({ id, rank }) => ({ id, rank }))).toEqual([
			{ id: "first", rank: 1 },
			{ id: "early", rank: 2 },
			{ id: "late", rank: 2 },
			{ id: "last", rank: 4 },
		])
	})

	it("keeps final ranks and solved segments but hides current at the exact end", () => {
		const [row] = adminTeamRows(season, [team()], end)
		expect(row?.rank).toBe(1)
		expect(row?.status).toEqual({ kind: "stopped", quest: "Admin title" })
		expect(row?.rail[0]?.segments.map(({ state }) => state)).toEqual(["todo", "solved"])
	})

	it.each([now, end])("shows completed teams as finished in started seasons at %s", (time) => {
		const [row] = adminTeamRows(season, [team({ completed: true, questIndex: 2 })], time)
		expect(row?.status).toEqual({ kind: "finished" })
	})

	it.each([null, new Date("2026-03-14T18:31:00Z")])(
		"hides ranks and progress and sorts by name before start %s",
		(futureStart) => {
			const upcoming = { ...season, start: futureStart }
			const teams = [
				team({ name: "Zulu", score: 100, completed: true }),
				team({ _id: "alpha", name: "Alpha", score: -5 }),
			]
			const original = structuredClone({ upcoming, teams })
			const rows = adminTeamRows(upcoming, teams, now)
			expect(rows.map(({ name, rank, status }) => ({ name, rank, status }))).toEqual([
				{ name: "Alpha", rank: null, status: { kind: "before" } },
				{ name: "Zulu", rank: null, status: { kind: "before" } },
			])
			expect(rows.every((row) => row.rail.every((arc) => arc.segments.every(({ state }) => state === "todo")))).toBe(
				true,
			)
			expect({ upcoming, teams }).toEqual(original)
		},
	)

	it("uses the display title when there is no internal title at the exact start", () => {
		const [row] = adminTeamRows(season, [team({ questIndex: 0 })], start)
		expect(row?.status).toEqual({ kind: "on", quest: "Display only" })
	})

	it.each([now, end])("keeps unloaded teams before when currentQuest returns nothing at %s", (time) => {
		const unloaded = team({ questOrder: [], questIndex: 0, progress: [] })
		expect(currentQuest(season, unloaded)).toBeUndefined()
		expect(adminTeamRows(season, [unloaded], time)[0]?.status).toEqual({ kind: "before" })
	})

	it("shows the first authored quest only when currentQuest returns it", () => {
		const loaded = team({ questOrder: ["q1", "q2"], questIndex: 0, progress: [] })
		expect(currentQuest(season, loaded)?.quest.id).toBe("q1")
		expect(adminTeamRows(season, [loaded], now)[0]?.status).toEqual({ kind: "on", quest: "Admin title" })
	})

	it("returns no rows without teams", () => {
		expect(adminTeamRows(season, [], now)).toEqual([])
	})
})
