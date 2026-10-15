import { describe, expect, it } from "vitest"
import { keyboardTarget, moveArc, moveHint, moveQuest } from "./reorder"
import type { Arc, Hint, Quest } from "./schemas"

function hint(id: string, text = id, points = 1): Hint {
	return { id, text, points }
}

function quest(id: string, hints: Hint[] = []): Quest {
	return {
		id,
		displayTitle: id,
		internalTitle: id,
		content: `${id} content`,
		assetPath: null,
		answers: [`${id} answer`],
		points: 10,
		adminNotes: `${id} notes`,
		hints,
	}
}

function arc(id: string, quests: Quest[] = []): Arc {
	return { id, title: id, shuffleQuests: false, quests }
}

function deepFreeze<T>(value: T): T {
	if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
		Object.freeze(value)
		Object.values(value).forEach(deepFreeze)
	}
	return value
}

describe("moveHint", () => {
	it.each([
		{ id: "h3", beforeId: "h1", expected: ["h3", "h1", "h2"] },
		{ id: "h1", beforeId: "h3", expected: ["h2", "h1", "h3"] },
		{ id: "h1", beforeId: null, expected: ["h2", "h3", "h1"] },
	])("moves $id before $beforeId", ({ id, beforeId, expected }) => {
		const hints = deepFreeze([hint("h1", "First", 5), hint("h2", "Second", 10), hint("h3", "Third", 15)])
		const input = deepFreeze(quest("q1", hints))
		const moved = moveHint(input, id, beforeId)

		expect(moved.map(({ id: hintId }) => hintId)).toEqual(expected)
		expect(moved).not.toBe(input.hints)
		expect(moved.find(({ id: hintId }) => hintId === id)).toEqual(hints.find(({ id: hintId }) => hintId === id))
		expect(input.hints).toEqual(hints)
	})

	it.each([
		{ id: "missing", beforeId: null },
		{ id: "h1", beforeId: "missing" },
		{ id: "h1", beforeId: "h1" },
		{ id: "h3", beforeId: null },
	])("returns original hints for no-op or unknown move $id before $beforeId", ({ id, beforeId }) => {
		const input = deepFreeze(quest("q1", [hint("h1"), hint("h2"), hint("h3")]))

		expect(moveHint(input, id, beforeId)).toBe(input.hints)
	})
})

describe("moveQuest", () => {
	it.each([
		{ id: "q3", toArcId: "a1", beforeId: "q1", expected: ["q3", "q1", "q2"] },
		{ id: "q1", toArcId: "a1", beforeId: "q3", expected: ["q2", "q1", "q3"] },
		{ id: "q1", toArcId: "a1", beforeId: null, expected: ["q2", "q3", "q1"] },
	])("moves quest to first, middle, or last position", ({ id, toArcId, beforeId, expected }) => {
		const arcs = deepFreeze([arc("a1", [quest("q1"), quest("q2"), quest("q3")]), arc("a2")])
		const moved = moveQuest(arcs, id, toArcId, beforeId)

		expect(moved[0]?.quests.map(({ id: questId }) => questId)).toEqual(expected)
		expect(moved).not.toBe(arcs)
		expect(arcs[0]?.quests.map(({ id: questId }) => questId)).toEqual(["q1", "q2", "q3"])
	})

	it("moves quests across arcs in both directions and into an empty arc", () => {
		const arcs = deepFreeze([arc("a1", [quest("q1"), quest("q2")]), arc("a2", [quest("q3")]), arc("a3")])
		const toLaterArc = moveQuest(arcs, "q2", "a2", "q3")
		const toEarlierArc = moveQuest(toLaterArc, "q2", "a1", "q1")
		const toEmptyArc = moveQuest(arcs, "q1", "a3", null)

		expect(toLaterArc.map(({ quests }) => quests.map(({ id }) => id))).toEqual([["q1"], ["q2", "q3"], []])
		expect(toEarlierArc.map(({ quests }) => quests.map(({ id }) => id))).toEqual([["q2", "q1"], ["q3"], []])
		expect(toEmptyArc.map(({ quests }) => quests.map(({ id }) => id))).toEqual([["q2"], ["q3"], ["q1"]])
		expect(arcs.map(({ quests }) => quests.map(({ id }) => id))).toEqual([["q1", "q2"], ["q3"], []])
	})

	it.each([
		{ id: "missing", toArcId: "a1", beforeId: null },
		{ id: "q1", toArcId: "missing", beforeId: null },
		{ id: "q1", toArcId: "a1", beforeId: "missing" },
		{ id: "q1", toArcId: "a1", beforeId: "q1" },
		{ id: "q2", toArcId: "a1", beforeId: null },
	])("returns original arcs for no-op or unknown move $id", ({ id, toArcId, beforeId }) => {
		const input = deepFreeze([arc("a1", [quest("q1"), quest("q2")]), arc("a2")])

		expect(moveQuest(input, id, toArcId, beforeId)).toBe(input)
	})
})

describe("moveArc", () => {
	it.each([
		{ id: "a3", beforeId: "a1", expected: ["a3", "a1", "a2"] },
		{ id: "a1", beforeId: "a3", expected: ["a2", "a1", "a3"] },
		{ id: "a1", beforeId: null, expected: ["a2", "a3", "a1"] },
	])("moves arc to first, middle, or last position", ({ id, beforeId, expected }) => {
		const arcs = deepFreeze([arc("a1"), arc("a2"), arc("a3")])
		const moved = moveArc(arcs, id, beforeId)

		expect(moved.map(({ id: arcId }) => arcId)).toEqual(expected)
		expect(moved).not.toBe(arcs)
		expect(arcs.map(({ id: arcId }) => arcId)).toEqual(["a1", "a2", "a3"])
	})

	it.each([
		{ id: "missing", beforeId: null },
		{ id: "a1", beforeId: "missing" },
		{ id: "a1", beforeId: "a1" },
		{ id: "a3", beforeId: null },
	])("returns original arcs for no-op or unknown move $id before $beforeId", ({ id, beforeId }) => {
		const input = deepFreeze([arc("a1"), arc("a2"), arc("a3")])

		expect(moveArc(input, id, beforeId)).toBe(input)
	})
})

describe("keyboardTarget", () => {
	const modifiers = { altKey: true, shiftKey: false }

	it("maps Alt+ArrowUp and Alt+ArrowDown within each list", () => {
		const arcs = deepFreeze([
			arc("a1", [quest("q1", [hint("h1"), hint("h2"), hint("h3"), hint("h4")]), quest("q2"), quest("q3")]),
			arc("a2", [quest("q4"), quest("q5")]),
			arc("a3"),
		])

		expect(keyboardTarget(arcs, { kind: "hint", questId: "q1", id: "h2" }, "ArrowUp", modifiers)).toEqual({
			beforeId: "h1",
		})
		expect(keyboardTarget(arcs, { kind: "hint", questId: "q1", id: "h2" }, "ArrowDown", modifiers)).toEqual({
			beforeId: "h4",
		})
		expect(keyboardTarget(arcs, { kind: "quest", id: "q2" }, "ArrowUp", modifiers)).toEqual({
			toArcId: "a1",
			beforeId: "q1",
		})
		expect(keyboardTarget(arcs, { kind: "quest", id: "q2" }, "ArrowDown", modifiers)).toEqual({
			toArcId: "a1",
			beforeId: null,
		})
		expect(keyboardTarget(arcs, { kind: "arc", id: "a2" }, "ArrowUp", modifiers)).toEqual({
			beforeId: "a1",
		})
		expect(keyboardTarget(arcs, { kind: "arc", id: "a2" }, "ArrowDown", modifiers)).toEqual({
			beforeId: null,
		})
	})

	it("moves quest to previous arc end and next arc start", () => {
		const arcs = deepFreeze([arc("a1", [quest("q1")]), arc("a2", [quest("q2"), quest("q3")]), arc("a3")])
		const shifted = { altKey: true, shiftKey: true }

		expect(keyboardTarget(arcs, { kind: "quest", id: "q2" }, "ArrowUp", shifted)).toEqual({
			toArcId: "a1",
			beforeId: null,
		})
		expect(keyboardTarget(arcs, { kind: "quest", id: "q2" }, "ArrowDown", shifted)).toEqual({
			toArcId: "a3",
			beforeId: null,
		})
	})

	it("returns null at list and arc edges, for unknown items, and without Alt or an arrow", () => {
		const arcs = deepFreeze([arc("a1", [quest("q1", [hint("h1")]), quest("q2")]), arc("a2", [quest("q3")])])
		const shift = { altKey: true, shiftKey: true }

		expect(keyboardTarget(arcs, { kind: "hint", questId: "q1", id: "h1" }, "ArrowUp", modifiers)).toBeNull()
		expect(keyboardTarget(arcs, { kind: "hint", questId: "q1", id: "h1" }, "ArrowDown", modifiers)).toBeNull()
		expect(keyboardTarget(arcs, { kind: "quest", id: "q1" }, "ArrowUp", modifiers)).toBeNull()
		expect(keyboardTarget(arcs, { kind: "quest", id: "q3" }, "ArrowDown", modifiers)).toBeNull()
		expect(keyboardTarget(arcs, { kind: "quest", id: "q1" }, "ArrowUp", shift)).toBeNull()
		expect(keyboardTarget(arcs, { kind: "quest", id: "q3" }, "ArrowDown", shift)).toBeNull()
		expect(keyboardTarget(arcs, { kind: "arc", id: "a1" }, "ArrowUp", modifiers)).toBeNull()
		expect(keyboardTarget(arcs, { kind: "arc", id: "a2" }, "ArrowDown", modifiers)).toBeNull()
		expect(keyboardTarget(arcs, { kind: "quest", id: "missing" }, "ArrowUp", modifiers)).toBeNull()
		expect(keyboardTarget(arcs, { kind: "hint", questId: "missing", id: "h1" }, "ArrowUp", modifiers)).toBeNull()
		expect(keyboardTarget(arcs, { kind: "arc", id: "a1" }, "ArrowUp", { altKey: false, shiftKey: false })).toBeNull()
		expect(keyboardTarget(arcs, { kind: "arc", id: "a1" }, "Enter", modifiers)).toBeNull()
	})

	it("uses the end of an empty previous arc and the first position of an empty next arc", () => {
		const arcs = deepFreeze([arc("a1"), arc("a2", [quest("q1")]), arc("a3")])
		const shift = { altKey: true, shiftKey: true }

		expect(keyboardTarget(arcs, { kind: "quest", id: "q1" }, "ArrowUp", shift)).toEqual({
			toArcId: "a1",
			beforeId: null,
		})
		expect(keyboardTarget(arcs, { kind: "quest", id: "q1" }, "ArrowDown", shift)).toEqual({
			toArcId: "a3",
			beforeId: null,
		})
	})
})
