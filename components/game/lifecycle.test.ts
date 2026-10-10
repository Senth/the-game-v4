import { describe, expect, it } from "vitest"
import { lifecycleView } from "./lifecycle"

const now = new Date("2026-10-10T18:00:00Z")
const day = 24 * 60 * 60 * 1000

describe("lifecycleView", () => {
	it("shows waiting copy without a value", () => {
		expect(lifecycleView({ lifecycleState: "waiting" }, now)).toEqual({
			sentence: "The game hasn't been scheduled yet.",
			value: null,
			helper: "This page updates by itself.",
		})
	})

	it.each([
		[272_000, "4:32"],
		[7_170_000, "1:59:30"],
		[day - 1000, "23:59:59"],
		[day - 1, "23:59:59"],
	])("formats a countdown %i ms away as %s", (distance, text) => {
		const start = new Date(now.getTime() + distance)
		expect(lifecycleView({ lifecycleState: "countdown", start }, now)).toEqual({
			sentence: "The game starts in",
			value: { kind: "countdown", date: start, band: "under-24-hours", text },
			helper: null,
		})
	})

	it.each([
		[day, "under-7-days"],
		[7 * day - 1000, "under-7-days"],
		[7 * day - 1, "under-7-days"],
		[7 * day, "7-days-or-more"],
		[8 * day, "7-days-or-more"],
	] as const)("leaves a start %i ms away unformatted in band %s", (distance, band) => {
		const start = new Date(now.getTime() + distance)
		expect(lifecycleView({ lifecycleState: "countdown", start }, now)).toEqual({
			sentence: "The game starts",
			value: { kind: "countdown", date: start, band, text: null },
			helper: null,
		})
	})

	it.each([0, -1, -1000])("shows starting copy at %i ms without a clock", (distance) => {
		expect(lifecycleView({ lifecycleState: "countdown", start: new Date(now.getTime() + distance) }, now)).toEqual({
			sentence: "The game is starting…",
			value: null,
			helper: null,
		})
	})

	it.each([120, 0, -5])("shows completed copy and %ip without rank", (score) => {
		expect(lifecycleView({ lifecycleState: "completed", score }, now)).toEqual({
			sentence: "You solved every quest.",
			value: { kind: "score", text: `${score}p` },
			helper: null,
		})
	})

	it.each([64, 0, -5])("shows ended copy and %ip without rank", (score) => {
		expect(lifecycleView({ lifecycleState: "ended", score }, now)).toEqual({
			sentence: "Time's up.",
			value: { kind: "score", text: `${score}p` },
			helper: null,
		})
	})

	it("leaves countdown input and server time unchanged", () => {
		const game = { lifecycleState: "countdown" as const, start: new Date(now.getTime() + day) }
		const before = structuredClone(game)
		const serverTime = now.getTime()
		lifecycleView(game, now)
		expect(game).toEqual(before)
		expect(now.getTime()).toBe(serverTime)
	})
})
