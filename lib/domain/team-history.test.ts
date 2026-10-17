import { describe, expect, it } from "vitest"
import { type Quest, Season, Team } from "./schemas"
import { teamHistory } from "./team-history"

const start = new Date("2026-03-14T18:00:00Z")
const now = new Date("2026-03-14T18:30:00Z")
const end = new Date("2026-03-14T19:00:00Z")
const quest = (id: string, internalTitle = ""): Quest => ({
	id,
	displayTitle: `Display ${id}`,
	internalTitle,
	content: "",
	assetPath: null,
	answers: [],
	points: 30,
	adminNotes: "",
	hints: [
		{ id: "h1", text: "Edited first hint", points: 9 },
		{ id: "h2", text: "Edited second hint", points: 12 },
	],
})
const season = Season.parse({
	_id: "season",
	title: "Cipher Night",
	lengthMinutes: 60,
	start,
	end,
	shuffleArcs: true,
	arcs: [
		{ id: "a1", title: "Lighthouse", shuffleQuests: true, quests: [quest("q1", " Admin title "), quest("q2")] },
		{ id: "a2", title: "Finale", shuffleQuests: false, quests: [quest("q3")] },
	],
})
const team = Team.parse({
	_id: "ninjas",
	name: "Ninjas",
	passwordHash: "secret",
	seasonId: season._id,
	questOrder: ["q2", "q1", "q3"],
	questIndex: 1,
	score: 25,
	completed: false,
	progress: [
		{
			questId: "q2",
			solvedAt: start,
			pointsEarned: 25,
			hintsRevealed: [{ hintId: "h1", text: "Solved snapshot", points: 5, revealedAt: start }],
		},
		{
			questId: "q1",
			pointsEarned: 0,
			hintsRevealed: [
				{ hintId: "deleted-late", text: "Deleted later", points: 3, revealedAt: now },
				{ hintId: "h2", text: "Second snapshot", points: 4, revealedAt: start },
				{ hintId: "deleted-early", text: "Deleted earlier", points: 2, revealedAt: start },
				{ hintId: "h1", text: "First snapshot", points: 1, revealedAt: now },
			],
		},
	],
})

describe("teamHistory", () => {
	it("keeps authored order, admin labels, earnings and snapshot hints without mutating inputs", () => {
		const original = structuredClone({ season, team, now })
		const history = teamHistory(season, team, now)
		expect(history.stats).toEqual({
			score: 25,
			solved: 1,
			total: 3,
			hintLoss: 15,
			state: { kind: "running", band: "pace-2", label: "1 behind pace" },
		})
		expect(history.arcs).toEqual([
			{
				id: "a1",
				title: "Lighthouse",
				quests: [
					{
						id: "q1",
						label: "Admin title",
						status: "current",
						pointsEarned: 0,
						hints: [
							{ hintId: "h1", label: "H1", text: "First snapshot", points: 1 },
							{ hintId: "h2", label: "H2", text: "Second snapshot", points: 4 },
							{ hintId: "deleted-early", label: "H?", text: "Deleted earlier", points: 2 },
							{ hintId: "deleted-late", label: "H?", text: "Deleted later", points: 3 },
						],
					},
					{
						id: "q2",
						label: "Display q2",
						status: "solved",
						pointsEarned: 25,
						hints: [{ hintId: "h1", label: "H1", text: "Solved snapshot", points: 5 }],
					},
				],
			},
			{
				id: "a2",
				title: "Finale",
				quests: [{ id: "q3", label: "Display q3", status: "todo", pointsEarned: 0, hints: [] }],
			},
		])
		expect(history.removed).toEqual([])
		expect({ season, team, now }).toEqual(original)
	})

	it.each([null, new Date("2026-03-14T18:31:00Z")])("shows every quest as todo before start %s", (futureStart) => {
		const history = teamHistory({ ...season, start: futureStart }, team, now)
		expect(history.stats.state).toEqual({ kind: "before" })
		expect(history.arcs.flatMap((arc) => arc.quests.map((entry) => entry.status))).toEqual(["todo", "todo", "todo"])
	})

	it("stops only the unfinished current quest at the exact end", () => {
		const history = teamHistory(season, team, end)
		expect(history.stats.state).toEqual({ kind: "ended" })
		expect(history.arcs[0]?.quests.map((entry) => entry.status)).toEqual(["stopped", "solved"])
		expect(history.arcs[0]?.quests[0]?.hints).toHaveLength(4)
	})

	it.each([now, end])("never marks a completed team's quest current or stopped at %s", (time) => {
		const history = teamHistory(season, { ...team, completed: true }, time)
		expect(history.stats.state).toEqual({ kind: "finished" })
		expect(history.arcs.flatMap((arc) => arc.quests.map((entry) => entry.status))).toEqual(["todo", "solved", "todo"])
	})

	it.each([
		[start, "1 ahead of pace", "pace-ok"],
		[new Date("2026-03-14T18:20:00Z"), "On pace", "pace-ok"],
		[now, "1 behind pace", "pace-2"],
	])("uses shared pace math at %s", (time, label, band) => {
		expect(teamHistory(season, team, time).stats.state).toEqual({ kind: "running", label, band })
	})

	it("retains skipped and solved removed quests and includes their hint penalties", () => {
		const removedTeam = {
			...team,
			questOrder: [...team.questOrder, "removed-solved"],
			progress: [
				...team.progress,
				{
					questId: "removed-skipped",
					pointsEarned: 0,
					hintsRevealed: [{ hintId: "old", text: "Skipped snapshot", points: 5, revealedAt: start }],
				},
				{ questId: "removed-solved", solvedAt: start, pointsEarned: -3, hintsRevealed: [] },
			],
		}
		const original = structuredClone(removedTeam)
		const history = teamHistory(season, removedTeam, now)
		expect(history.removed).toEqual([
			{
				questId: "removed-skipped",
				solved: false,
				pointsEarned: 0,
				hints: [{ hintId: "old", label: "H?", text: "Skipped snapshot", points: 5 }],
			},
			{ questId: "removed-solved", solved: true, pointsEarned: -3, hints: [] },
		])
		expect(history.stats).toMatchObject({ solved: 2, total: 4, hintLoss: 20 })
		expect(removedTeam).toEqual(original)
	})

	it("handles unloaded orders and untitled draft quests", () => {
		const history = teamHistory(season, { ...team, questOrder: [], questIndex: 0, progress: [] }, now)
		expect(history.stats).toMatchObject({ solved: 0, total: 0, hintLoss: 0 })
		expect(history.arcs[0]?.quests[0]?.status).toBe("todo")
		expect(
			teamHistory(
				{ ...season, arcs: season.arcs.map((arc) => ({ ...arc, quests: [{ ...quest("q1"), displayTitle: " " }] })) },
				team,
				now,
			).arcs[0]?.quests[0]?.label,
		).toBeNull()
	})
})
