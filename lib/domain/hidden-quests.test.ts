import { describe, expect, it } from "vitest"
import { liveControls } from "./admin-seasons"
import { buildQuestOrder, currentQuest, rail, standingsRows } from "./game"
import { playerGame, playerStandings, publicBoard } from "./player-game"
import { questLiveStats } from "./quest-stats"
import type { Season, Team } from "./schemas"
import { newQuest } from "./season-tree"
import { teamHistory } from "./team-history"

const now = new Date("2026-10-17T18:30:00Z")
const hidden = {
	...newQuest(),
	id: "hidden-quest",
	hidden: true,
	displayTitle: "Hidden display title",
	internalTitle: "Hidden internal title",
	content: "Hidden content",
	answers: ["Hidden answer"],
	assetPath: "/assets/hidden.png",
	hints: [{ id: "hidden-hint", text: "Hidden hint text", points: 5 }],
}
const visible = { ...newQuest(), id: "visible-quest", hidden: false }
const season: Season = {
	finisherBonuses: [],
	finishers: [],
	_id: "season",
	title: "Season",
	lengthMinutes: 60,
	start: new Date("2026-10-17T18:00:00Z"),
	end: new Date("2026-10-17T19:00:00Z"),
	shuffleArcs: false,
	registrationOpen: false,
	arcs: [{ id: "arc", title: "Arc", shuffleQuests: false, quests: [hidden, visible] }],
}
const team: Team = {
	_id: "team",
	name: "Ninjas",
	passwordHash: "hash",
	seasonId: season._id,
	questOrder: [visible.id],
	questIndex: 0,
	score: 0,
	completed: false,
	progress: [],
}

describe("hidden quests", () => {
	it.each([false, true])("excludes hidden drafts from order builds with shuffle %s", (shuffle) => {
		const input = {
			...season,
			shuffleArcs: shuffle,
			arcs: season.arcs.map((arc) => ({ ...arc, shuffleQuests: shuffle })),
		}
		const original = structuredClone(input)
		expect(buildQuestOrder(input, () => 0)).toEqual([visible.id])
		expect(input).toEqual(original)
	})

	it("keeps hidden ids, content, titles, answers, assets and hints out of every player payload", () => {
		const original = structuredClone({ season, team })
		const expectedRail = [{ arcId: "arc", segments: [{ questId: visible.id, state: "current" }] }]
		expect(rail(season, team)).toEqual(expectedRail)
		const game = playerGame(season, team, [team], now)
		expect(game).toMatchObject({ lifecycleState: "running", total: 1, quest: { id: visible.id }, rail: expectedRail })
		const rows = standingsRows(season, [team], team._id, true)
		expect(rows[0]).toMatchObject({ total: 1, rail: expectedRail })
		for (const payload of [
			game,
			rows,
			playerStandings(season, team, [team], now),
			publicBoard([season], { season: [team] }, now),
		]) {
			const json = JSON.stringify(payload)
			for (const secret of [
				hidden.id,
				hidden.displayTitle,
				hidden.internalTitle,
				hidden.content,
				...hidden.answers,
				hidden.assetPath,
				hidden.hints[0]?.text,
			]) {
				expect(json).not.toContain(secret)
			}
		}
		expect({ season, team }).toEqual(original)
	})

	it("does not expose a hidden current quest even through a stale order", () => {
		const stale = { ...team, questOrder: [hidden.id] }
		expect(currentQuest(season, stale)).toBeUndefined()
		expect(playerGame(season, stale, [stale], now)).toMatchObject({ quest: null })
	})

	it("omits hidden drafts from live stats and team history without changing inputs", () => {
		const original = structuredClone({ season, team })
		expect(Object.keys(questLiveStats(season, [team]))).toEqual([visible.id])
		const history = teamHistory(season, team, now)
		expect(history.arcs[0]?.quests.map((quest) => quest.id)).toEqual([visible.id])
		expect(history.removed).toEqual([])
		expect({ season, team }).toEqual(original)
	})

	it("does not count hidden drafts toward Start now", () => {
		const input = { ...season, start: null, end: null, arcs: season.arcs.map((arc) => ({ ...arc, quests: [hidden] })) }
		expect(liveControls(input, now)).toMatchObject({ state: "start", hasQuests: false })
	})
})
