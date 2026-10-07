import { describe, expect, it } from "vitest"
import {
	applyStructuralEdit,
	buildQuestOrder,
	lifecycleState,
	matchesAnswer,
	pace,
	paceLabel,
	pickLoginTeam,
	playerView,
	rail,
	rankTeams,
	registrationConflict,
	registrationSeason,
	scoreForSolve,
	standingsStrip,
} from "./game"
import type { Arc, Quest, Season, TeamQuestProgress } from "./schemas"

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) deepFreeze(child)
		Object.freeze(value)
	}
	return value
}

function frozenCopy<T>(value: T): { frozen: T; original: T } {
	return { frozen: deepFreeze(structuredClone(value)), original: structuredClone(value) }
}

const quest = (id: string, points: number | null = 10): Quest => ({
	id,
	displayTitle: id,
	internalTitle: id,
	content: "",
	assetPath: null,
	answers: ["lighthouse", "fyren"],
	points,
	adminNotes: "",
	hints: [],
})

const arc = (id: string, questIds: string[], shuffleQuests = false): Arc => ({
	id,
	title: id,
	shuffleQuests,
	quests: questIds.map((questId) => quest(questId)),
})

const season = (arcs: Arc[], shuffleArcs = false): Season => ({
	_id: "s1",
	title: "Cipher Night",
	lengthMinutes: 120,
	start: null,
	end: null,
	shuffleArcs,
	registrationOpen: false,
	arcs,
})

describe("matchesAnswer", () => {
	it("matches a decomposed å against a precomposed å", () => {
		const { frozen, original } = frozenCopy(["R\u00E5"])
		expect(matchesAnswer("Ra\u030A", frozen)).toBe(true)
		expect(matchesAnswer("R\u00E5", ["Ra\u030A"])).toBe(true)
		expect(frozen).toEqual(original)
	})

	it("ignores surrounding spaces and case and accepts any listed answer", () => {
		expect(matchesAnswer("  LightHouse ", ["lighthouse", "fyren"])).toBe(true)
		expect(matchesAnswer("FYREN", [" Fyren  ", "lighthouse"])).toBe(true)
	})

	it("rejects wrong answers", () => {
		expect(matchesAnswer("light house", ["lighthouse"])).toBe(false)
		expect(matchesAnswer("lighthouse", [])).toBe(false)
	})
})

describe("scoreForSolve", () => {
	const revealedAt = new Date("2026-03-14T18:00:00Z")
	const progress = (points: number[]): TeamQuestProgress => ({
		questId: "q1",
		hintsRevealed: points.map((hintPoints, index) => ({
			hintId: `h${index}`,
			text: "hint",
			points: hintPoints,
			revealedAt,
		})),
		pointsEarned: 0,
	})

	it("subtracts every snapshot even when the quest no longer has those hints", () => {
		const { frozen, original } = frozenCopy({ quest: quest("q1", 30), progress: progress([5, 10, 20]) })
		expect(frozen.quest.hints).toEqual([])
		expect(scoreForSolve(frozen.quest, frozen.progress)).toBe(-5)
		expect(frozen).toEqual(original)
	})

	it("scores a draft without points as 0 minus penalties", () => {
		expect(scoreForSolve(quest("q1", null), progress([]))).toBe(0)
		expect(scoreForSolve(quest("q1", null), progress([5]))).toBe(-5)
	})

	it("returns full points without reveals", () => {
		expect(scoreForSolve(quest("q1", 25), progress([]))).toBe(25)
	})
})

const RUNS = 10_000

function worstDeviation(ids: string[], order: () => string[]): number {
	const counts = new Map<string, number>()
	for (let run = 0; run < RUNS; run++) {
		order().forEach((id, position) => {
			const key = `${id}@${position}`
			counts.set(key, (counts.get(key) ?? 0) + 1)
		})
	}
	const expected = RUNS / ids.length
	const cells = ids.flatMap((id) => ids.map((_, position) => counts.get(`${id}@${position}`) ?? 0))
	return Math.max(...cells.map((count) => Math.abs(count - expected) / expected))
}

describe("buildQuestOrder", () => {
	const authored = season([arc("a1", ["q1", "q2", "q3"]), arc("a2", ["q4", "q5", "q6"]), arc("a3", ["q7", "q8"])])

	it("keeps authored order when nothing shuffles", () => {
		const { frozen, original } = frozenCopy(authored)
		expect(buildQuestOrder(frozen, () => 0)).toEqual(["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"])
		expect(frozen).toEqual(original)
	})

	it("shuffles quests only inside flagged arcs", () => {
		const { frozen, original } = frozenCopy(
			season([arc("a1", ["q1", "q2", "q3"]), arc("a2", ["q4", "q5", "q6"], true), arc("a3", ["q7", "q8"])]),
		)
		expect(buildQuestOrder(frozen, () => 0)).toEqual(["q1", "q2", "q3", "q5", "q6", "q4", "q7", "q8"])
		expect(frozen).toEqual(original)
	})

	it("moves arcs as whole groups when shuffleArcs is set", () => {
		const { frozen, original } = frozenCopy({ ...authored, shuffleArcs: true })
		expect(buildQuestOrder(frozen, () => 0)).toEqual(["q4", "q5", "q6", "q7", "q8", "q1", "q2", "q3"])
		expect(frozen).toEqual(original)
	})

	const ids = ["q1", "q2", "q3", "q4", "q5"]
	const sortShuffle = () => [...ids].sort(() => Math.random() - 0.5)

	it("places each quest at each position within 15% of uniform", () => {
		const { frozen, original } = frozenCopy(season([arc("a1", ids, true)]))
		expect(worstDeviation(ids, () => buildQuestOrder(frozen))).toBeLessThan(0.15)
		expect(worstDeviation(ids, sortShuffle)).toBeGreaterThan(0.15)
		expect(frozen).toEqual(original)
	})

	it("places each arc at each position within 15% of uniform", () => {
		const { frozen, original } = frozenCopy(
			season(
				ids.map((id) => arc(`arc-${id}`, [id])),
				true,
			),
		)
		expect(worstDeviation(ids, () => buildQuestOrder(frozen))).toBeLessThan(0.15)
		expect(frozen).toEqual(original)
	})
})

describe("pace", () => {
	const start = new Date("2026-03-14T18:00:00Z")
	const minutes = (count: number) => new Date(start.getTime() + count * 60_000)
	const running = { start, end: minutes(100) }
	const order = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10"]
	const team = (solved: number, questOrder = order) => ({
		questOrder,
		progress: questOrder.slice(0, solved).map((questId) => ({
			questId,
			solvedAt: start,
			hintsRevealed: [],
			pointsEarned: 10,
		})),
	})

	it.each([
		[10, 100, 1, 10, 0, "pace-ok"],
		[11, 100, 1, 10, 1, "pace-1"],
		[10, 100, 0, 10, 10, "pace-1"],
		[11, 100, 0, 10, 11, "pace-2"],
		[20, 100, 0, 10, 20, "pace-2"],
		[21, 100, 0, 10, 21, "pace-3"],
		[52, 120, 1, 3, 10, "pace-1"],
	])(
		"at %i of %i minutes with %i of %i solved is %i%% behind in band %s",
		(minute, duration, solved, quests, behindPercent, band) => {
			const { frozen, original } = frozenCopy({
				season: { start, end: minutes(duration) },
				team: team(solved, order.slice(0, quests)),
			})
			expect(pace(frozen.season, frozen.team, minutes(minute))).toMatchObject({ behindPercent, band })
			expect(frozen).toEqual(original)
		},
	)

	it("reports percentages and N for a team ahead", () => {
		expect(pace(running, team(5), minutes(30))).toEqual({
			timePercent: 30,
			solvedPercent: 50,
			behindPercent: -20,
			band: "pace-ok",
			n: -2,
		})
	})

	it("colors by percentage when N rounds to 0", () => {
		expect(pace(running, team(0), minutes(4))).toMatchObject({ n: 0, behindPercent: 4, band: "pace-1" })
	})

	it("clamps time at 0 before start and at 1 after end", () => {
		expect(pace(running, team(0), minutes(-30))).toMatchObject({ timePercent: 0, n: 0, band: "pace-ok" })
		expect(pace(running, team(4), minutes(150))).toMatchObject({ timePercent: 100, behindPercent: 60, n: 6 })
	})

	it("counts only solved progress for quests in the order", () => {
		const { progress } = team(3)
		const removed = { questId: "gone", solvedAt: start, hintsRevealed: [], pointsEarned: 10 }
		const unsolved = { questId: "q4", hintsRevealed: [], pointsEarned: 0 }
		const counted = { questOrder: order, progress: [...progress, removed, unsolved] }
		expect(pace(running, counted, minutes(50))).toMatchObject({ solvedPercent: 30, n: 2 })
	})

	it("returns null without dividing for zero duration, missing start or end and an empty order", () => {
		expect(pace({ start, end: start }, team(0), start)).toBeNull()
		expect(pace({ start: null, end: minutes(100) }, team(0), start)).toBeNull()
		expect(pace({ start, end: null }, team(0), start)).toBeNull()
		expect(pace(running, team(0, []), minutes(50))).toBeNull()
	})
})

describe("paceLabel", () => {
	it("names behind, ahead and on pace", () => {
		expect(paceLabel(3)).toBe("3 behind")
		expect(paceLabel(-2)).toBe("2 ahead")
		expect(paceLabel(0)).toBe("On pace")
	})
})

describe("rankTeams and standingsStrip", () => {
	const at = (minute: number) => new Date(Date.UTC(2026, 2, 14, 18, minute))
	const team = (name: string, score: number, solvedMinutes: number[] = []) => ({
		_id: name.toLowerCase(),
		name,
		passwordHash: "hash",
		seasonId: "s1",
		questOrder: ["q1", "q2"],
		questIndex: 0,
		score,
		completed: false,
		progress: solvedMinutes.map((minute, index) => ({
			questId: `q${index + 1}`,
			solvedAt: at(minute),
			hintsRevealed: [],
			pointsEarned: 10,
		})),
	})
	const field = [
		team("Lagom", 70, [40]),
		team("Ravarna", 120, [50]),
		team("Kaos", 105, [30]),
		team("Fjallrav", 98, [20]),
		team("Byggarna", 90, [10]),
		team("Glada", 82, [15]),
		team("Ninjas", 64, [5]),
		team("Kod", 50, [1]),
	]
	const row = (rank: number, name: string, score: number, you = false) => ({
		kind: "team",
		rank,
		id: name.toLowerCase(),
		name,
		score,
		you,
	})

	it("shares ranks on equal score, earliest last solve first, then unsolved teams by name", () => {
		const { frozen, original } = frozenCopy([
			team("Zeta", 0),
			team("Late", 90, [10, 50]),
			team("Top", 100, [30]),
			team("Early", 90, [5, 40]),
			team("Alpha", 0),
			team("Low", 80, [60]),
		])
		expect(rankTeams(frozen).map(({ name, rank }) => [rank, name])).toEqual([
			[1, "Top"],
			[2, "Early"],
			[2, "Late"],
			[4, "Low"],
			[5, "Alpha"],
			[5, "Zeta"],
		])
		expect(frozen).toEqual(original)
	})

	it("shows only you at #1", () => {
		const { frozen, original } = frozenCopy(field)
		expect(standingsStrip(frozen, "ravarna")).toEqual([row(1, "Ravarna", 120, true)])
		expect(frozen).toEqual(original)
	})

	it("shows #1 and you at #2 without a duplicate or gap", () => {
		expect(standingsStrip(field, "kaos")).toEqual([row(1, "Ravarna", 120), row(2, "Kaos", 105, true)])
	})

	it("shows #1, the row above and you at #3 without a gap", () => {
		expect(standingsStrip(field, "fjallrav")).toEqual([
			row(1, "Ravarna", 120),
			row(2, "Kaos", 105),
			row(3, "Fjallrav", 98, true),
		])
	})

	it("inserts a gap between #1 and the row above you at #7", () => {
		expect(standingsStrip(field, "ninjas")).toEqual([
			row(1, "Ravarna", 120),
			{ kind: "gap" },
			row(6, "Lagom", 70),
			row(7, "Ninjas", 64, true),
		])
	})

	it("shows only you when tied for #1", () => {
		const tied = [team("First", 100, [10]), team("Second", 100, [20]), team("Third", 90, [5])]
		expect(standingsStrip(tied, "second")).toEqual([row(1, "Second", 100, true)])
	})

	it("uses shared ranks for ties below #1", () => {
		const tied = [team("Top", 100, [1]), team("Ahead", 80, [10]), team("Mine", 80, [20]), team("Last", 70, [5])]
		expect(standingsStrip(tied, "mine")).toEqual([row(1, "Top", 100), row(2, "Ahead", 80), row(2, "Mine", 80, true)])
		expect(standingsStrip(tied, "last")).toEqual([
			row(1, "Top", 100),
			{ kind: "gap" },
			row(2, "Mine", 80),
			row(4, "Last", 70, true),
		])
	})

	it("carries no private team fields", () => {
		for (const entry of standingsStrip(field, "ninjas")) {
			expect(Object.keys(entry).sort()).toEqual(
				entry.kind === "gap" ? ["kind"] : ["id", "kind", "name", "rank", "score", "you"],
			)
		}
	})
})

describe("playerView", () => {
	const revealedAt = new Date("2026-03-14T18:00:00Z")
	const secretQuest: Quest = {
		...quest("backwards-log", 30),
		displayTitle: "The keeper's last log",
		internalTitle: "internal-backwards-log",
		content: "Read the log in reverse.",
		assetPath: "backwards-log.png",
		answers: ["secret-answer-one", "secret-answer-two"],
		adminNotes: "secret admin note",
		hints: [
			{ id: "h1", text: "Edited wording", points: 8 },
			{ id: "h2", text: "secret hidden hint", points: 10 },
			{ id: "h3", text: "another secret hint", points: 20 },
		],
	}
	const progress: TeamQuestProgress = {
		questId: "backwards-log",
		hintsRevealed: [
			{ hintId: "h1", text: "Original wording", points: 5, revealedAt },
			{ hintId: "deleted", text: "Deleted hint", points: 3, revealedAt },
		],
		pointsEarned: 0,
	}
	const shared = season([{ id: "a1", title: "Lighthouse", shuffleQuests: false, quests: [secretQuest] }])

	it("shows current hints in order with snapshots for revealed ones and appends deleted reveals", () => {
		expect(playerView(secretQuest, progress)).toEqual({
			id: "backwards-log",
			displayTitle: "The keeper's last log",
			content: "Read the log in reverse.",
			assetPath: "backwards-log.png",
			points: 30,
			worth: 22,
			hints: [
				{ id: "h1", position: 1, points: 5, text: "Original wording", revealed: true },
				{ id: "h2", position: 2, points: 10, revealed: false },
				{ id: "h3", position: 3, points: 20, revealed: false },
				{ id: "deleted", position: 4, points: 3, text: "Deleted hint", revealed: true },
			],
		})
	})

	it("treats missing progress as nothing revealed", () => {
		const view = playerView(secretQuest)
		expect(view.worth).toBe(30)
		expect(view.hints.map((hint) => hint.revealed)).toEqual([false, false, false])
	})

	it("serializes no answer, internal title, admin note or hidden hint text", () => {
		const json = JSON.stringify(playerView(secretQuest, progress))
		for (const secret of [
			"secret-answer-one",
			"secret-answer-two",
			"internal-backwards-log",
			"secret admin note",
			"secret hidden hint",
			"another secret hint",
			"Edited wording",
		]) {
			expect(json).not.toContain(secret)
		}
	})

	it("leaves a shared deep-frozen season unchanged", () => {
		const { frozen, original } = frozenCopy({ season: shared, progress })
		const sharedQuest = frozen.season.arcs[0]?.quests[0] as Quest
		playerView(sharedQuest, frozen.progress)
		playerView(sharedQuest)
		expect(frozen).toEqual(original)
	})
})

describe("lifecycleState", () => {
	const start = new Date("2026-03-14T18:00:00Z")
	const end = new Date("2026-03-14T20:00:00Z")
	const playing = { completed: false }
	const done = { completed: true }

	it("waits without a season or a start time", () => {
		expect(lifecycleState(null, playing, start)).toBe("waiting")
		expect(lifecycleState({ start: null, end: null }, playing, start)).toBe("waiting")
	})

	it("counts down before start and runs from exactly start", () => {
		const { frozen, original } = frozenCopy({ start, end })
		expect(lifecycleState(frozen, playing, new Date(start.getTime() - 1))).toBe("countdown")
		expect(lifecycleState(frozen, playing, start)).toBe("running")
		expect(frozen).toEqual(original)
	})

	it("ends at exactly end", () => {
		expect(lifecycleState({ start, end }, playing, new Date(end.getTime() - 1))).toBe("running")
		expect(lifecycleState({ start, end }, playing, end)).toBe("ended")
	})

	it("keeps a team that completed before the end completed, during play and after end", () => {
		expect(lifecycleState({ start, end }, done, new Date(end.getTime() - 60_000))).toBe("completed")
		expect(lifecycleState({ start, end }, done, end)).toBe("completed")
	})
})

describe("registrationSeason", () => {
	const now = new Date("2026-03-14T18:00:00Z")
	const end = new Date(now.getTime() + 3_600_000)
	const open = { _id: "open", registrationOpen: true, end }
	const closed = { _id: "closed", registrationOpen: false, end: null }

	it("returns null when no season has registration open", () => {
		const { frozen, original } = frozenCopy([closed])
		expect(registrationSeason(frozen, now)).toBeNull()
		expect(registrationSeason([], now)).toBeNull()
		expect(frozen).toEqual(original)
	})

	it("returns the season with registration open, also without an end", () => {
		const { frozen, original } = frozenCopy([closed, open])
		expect(registrationSeason(frozen, now)?._id).toBe("open")
		expect(registrationSeason([{ ...open, end: null }], now)?._id).toBe("open")
		expect(frozen).toEqual(original)
	})

	it("does not count an ended season that kept its flag", () => {
		expect(registrationSeason([{ ...open, end: new Date(now.getTime() - 1) }], now)).toBeNull()
	})

	it("stops counting at exactly end", () => {
		expect(registrationSeason([open], new Date(end.getTime() - 1))?._id).toBe("open")
		expect(registrationSeason([open], end)).toBeNull()
	})
})

describe("registrationConflict", () => {
	const now = new Date("2026-03-14T18:00:00Z")
	const later = new Date(now.getTime() + 3_600_000)
	const earlier = new Date(now.getTime() - 1)
	const a = { _id: "a", registrationOpen: true, end: later }
	const b = { _id: "b", registrationOpen: false, end: null }

	it("returns the other counting season that has registration open", () => {
		const { frozen, original } = frozenCopy([a, b])
		expect(registrationConflict(frozen, "b", now)?._id).toBe("a")
		expect(frozen).toEqual(original)
	})

	it("ignores an ended season that kept its flag", () => {
		expect(registrationConflict([{ ...a, end: earlier }, b], "b", now)).toBeNull()
	})

	it("does not count the season itself as a conflict", () => {
		expect(registrationConflict([a, b], "a", now)).toBeNull()
	})

	it("returns the season itself when it has ended", () => {
		expect(registrationConflict([{ ...b, end: earlier }], "b", now)?._id).toBe("b")
	})
})

describe("pickLoginTeam", () => {
	const now = new Date("2026-03-14T18:00:00Z")
	const hour = 3_600_000
	const open = { _id: "open", start: null, end: null, registrationOpen: true }
	const older = {
		_id: "older",
		start: new Date(now.getTime() - 48 * hour),
		end: new Date(now.getTime() - 46 * hour),
		registrationOpen: false,
	}
	const newer = {
		_id: "newer",
		start: new Date(now.getTime() - 24 * hour),
		end: new Date(now.getTime() - 22 * hour),
		registrationOpen: false,
	}
	const draft = { _id: "draft", start: null, end: null, registrationOpen: false }
	const seasons = [older, open, newer, draft]
	const team = (seasonId: string | null) => ({ _id: `t-${seasonId}`, seasonId })

	it("picks the team in the season with registration open", () => {
		const { frozen, original } = frozenCopy({ teams: [team("older"), team("open"), team("newer")], seasons })
		expect(pickLoginTeam(frozen.teams, frozen.seasons, now)?.seasonId).toBe("open")
		expect(frozen).toEqual(original)
	})

	it("else picks the team in the most recently started season", () => {
		const { frozen, original } = frozenCopy({ teams: [team("draft"), team("older"), team("newer")], seasons })
		expect(pickLoginTeam(frozen.teams, frozen.seasons, now)?.seasonId).toBe("newer")
		expect(frozen).toEqual(original)
	})

	it("ignores registration on an ended season", () => {
		const ended = { ...open, start: older.start, end: older.end }
		expect(pickLoginTeam([team("open"), team("newer")], [ended, newer], now)?.seasonId).toBe("newer")
	})

	it("else picks a team in an unstarted season, then a seasonless team", () => {
		expect(pickLoginTeam([team(null), team("draft")], seasons, now)?.seasonId).toBe("draft")
		expect(pickLoginTeam([team(null)], seasons, now)?.seasonId).toBeNull()
	})

	it("returns null without candidates", () => {
		expect(pickLoginTeam([], seasons, now)).toBeNull()
	})
})

describe("rail", () => {
	const railSeason = season([arc("a1", ["q1", "q2", "q3"], true), arc("a2", ["q4", "q5"], true)])
	const solvedAt = new Date("2026-03-14T18:30:00Z")
	const shuffledTeam = {
		questOrder: ["q3", "q1", "q2", "q5", "q4"],
		questIndex: 2,
		progress: [
			{ questId: "q3", solvedAt, hintsRevealed: [], pointsEarned: 10 },
			{ questId: "q1", solvedAt, hintsRevealed: [], pointsEarned: 10 },
			{ questId: "q2", hintsRevealed: [], pointsEarned: 0 },
		],
	}

	it("uses authored order and marks solved quests at their authored positions", () => {
		const { frozen, original } = frozenCopy({ season: railSeason, team: shuffledTeam })
		expect(rail(frozen.season, frozen.team)).toEqual([
			{
				arcId: "a1",
				segments: [
					{ questId: "q1", state: "solved" },
					{ questId: "q2", state: "current" },
					{ questId: "q3", state: "solved" },
				],
			},
			{
				arcId: "a2",
				segments: [
					{ questId: "q4", state: "todo" },
					{ questId: "q5", state: "todo" },
				],
			},
		])
		expect(frozen).toEqual(original)
	})
})

describe("applyStructuralEdit", () => {
	const revealedAt = new Date("2026-03-14T18:10:00Z")
	const solvedAt = new Date("2026-03-14T18:20:00Z")
	const snapshot = { hintId: "h1", text: "Look north", points: 5, revealedAt }
	const editTeam = (id: string, questOrder: string[], questIndex: number, completed = false) => ({
		_id: id,
		questOrder,
		questIndex,
		completed,
		score: 10 * questIndex,
		progress: questOrder.slice(0, questIndex).map((questId) => ({
			questId,
			solvedAt,
			hintsRevealed: [],
			pointsEarned: 10,
		})),
	})
	const onQ2 = {
		...editTeam("on-q2", ["q1", "q2", "q3"], 1),
		progress: [
			{ questId: "q1", solvedAt, hintsRevealed: [], pointsEarned: 10 },
			{ questId: "q2", hintsRevealed: [snapshot], pointsEarned: 0 },
		],
	}
	const done = editTeam("done", ["q1", "q2", "q3"], 3, true)
	const fresh = editTeam("fresh", ["q2", "q1", "q3"], 0)

	it("inserts an added quest after the current one and skips completed teams", () => {
		const { frozen, original } = frozenCopy([onQ2, done])
		const result = applyStructuralEdit(frozen, { kind: "addQuest", questId: "new" }, () => 0)
		expect(result.affected).toEqual(["on-q2"])
		expect(result.teams[0]?.questOrder).toEqual(["q1", "q2", "new", "q3"])
		expect(result.teams[1]).toBe(frozen[1])
		expect(frozen).toEqual(original)
	})

	it("can append an added quest at the end", () => {
		const result = applyStructuralEdit([onQ2], { kind: "addQuest", questId: "new" }, () => 0.999)
		expect(result.teams[0]?.questOrder).toEqual(["q1", "q2", "q3", "new"])
	})

	it("uses every slot after the current quest and never one at or before it", () => {
		const team = editTeam("t", ["q1", "q2", "q3", "q4"], 1)
		const slots = new Set<number>()
		for (let run = 0; run < 1000; run++) {
			const [edited] = applyStructuralEdit([team], { kind: "addQuest", questId: "new" }).teams
			slots.add(edited?.questOrder.indexOf("new") ?? -1)
		}
		expect([...slots].sort((a, b) => a - b)).toEqual([2, 3, 4])
	})

	it("removes a deleted quest the team has not reached", () => {
		const { frozen, original } = frozenCopy([onQ2, fresh])
		const result = applyStructuralEdit(frozen, { kind: "deleteQuest", questId: "q3" })
		expect(result.affected).toEqual(["on-q2", "fresh"])
		expect(result.teams.map((team) => [team.questOrder, team.questIndex])).toEqual([
			[["q1", "q2"], 1],
			[["q2", "q1"], 0],
		])
		expect(frozen).toEqual(original)
	})

	it("skips a deleted current quest with 0 points and keeps its revealed hints", () => {
		const { frozen, original } = frozenCopy([onQ2])
		const { teams, affected } = applyStructuralEdit(frozen, { kind: "deleteQuest", questId: "q2" })
		expect(affected).toEqual(["on-q2"])
		expect(teams[0]).toMatchObject({ questOrder: ["q1", "q3"], questIndex: 1, completed: false, score: 10 })
		expect(teams[0]?.progress).toEqual([
			{ questId: "q1", solvedAt, hintsRevealed: [], pointsEarned: 10 },
			{ questId: "q2", hintsRevealed: [snapshot], pointsEarned: 0 },
		])
		expect(frozen).toEqual(original)
	})

	it("records a skip for a current quest without progress", () => {
		const { teams } = applyStructuralEdit([fresh], { kind: "deleteQuest", questId: "q2" })
		expect(teams[0]?.progress).toEqual([{ questId: "q2", hintsRevealed: [], pointsEarned: 0 }])
	})

	it("completes a team whose current quest was the last remaining one", () => {
		const onLast = editTeam("on-last", ["q1", "q2"], 1)
		const { teams } = applyStructuralEdit([onLast], { kind: "deleteQuest", questId: "q2" })
		expect(teams[0]).toMatchObject({ questOrder: ["q1"], questIndex: 1, completed: true, score: 10 })
	})

	it("completes a team whose only quest is deleted", () => {
		const { teams } = applyStructuralEdit([editTeam("only", ["q1"], 0)], { kind: "deleteQuest", questId: "q1" })
		expect(teams[0]).toMatchObject({ questOrder: [], questIndex: 0, completed: true, score: 0 })
	})

	it("leaves teams that already solved the deleted quest unchanged and unaffected", () => {
		const { frozen } = frozenCopy([onQ2, done])
		const result = applyStructuralEdit(frozen, { kind: "deleteQuest", questId: "q1" })
		expect(result.affected).toEqual([])
		expect(result.teams[0]).toBe(frozen[0])
		expect(result.teams[1]).toBe(frozen[1])
	})
})
