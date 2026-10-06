import { describe, expect, it } from "vitest"
import { buildQuestOrder, matchesAnswer, scoreForSolve } from "./game"
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
