import { describe, expect, it } from "vitest"
import {
	formatSeasonDay,
	formatSeasonMonth,
	formatSeasonStart,
	groupSeasons,
	liveControls,
	NewSeasonTitle,
	overlappingSeason,
	scheduleWindow,
	seasonStatus,
	shiftEndWindow,
	startNowWindow,
} from "./admin-seasons"

const now = new Date("2026-10-11T17:00:00Z")
const before = new Date(now.getTime() - 1)
const after = new Date(now.getTime() + 1)
const minutesFromNow = (minutes: number) => new Date(now.getTime() + minutes * 60_000)

describe("season windows", () => {
	it.each([1, 60, 1440])("starts after twenty seconds for length %i without mutation", (lengthMinutes) => {
		const season = { start: after, end: minutesFromNow(120), lengthMinutes }
		const original = structuredClone({ season, now })
		const start = new Date(now.getTime() + 20_000)
		expect(startNowWindow(season, now)).toEqual({ start, end: new Date(start.getTime() + lengthMinutes * 60_000) })
		expect({ season, now }).toEqual(original)
	})

	it.each([1, 60, 1440])("schedules start plus length %i without mutation", (lengthMinutes) => {
		const original = structuredClone(after)
		expect(scheduleWindow(after, lengthMinutes)).toEqual({
			start: after,
			end: new Date(after.getTime() + lengthMinutes * 60_000),
		})
		expect(after).toEqual(original)
	})

	it("clears both dates when unscheduling", () => {
		expect(scheduleWindow(null, 60)).toEqual({ start: null, end: null })
	})
})

describe("shiftEndWindow", () => {
	it.each([
		{ start: now, end: minutesFromNow(10), delta: 5, expected: minutesFromNow(15) },
		{ start: before, end: minutesFromNow(10), delta: -5, expected: minutesFromNow(5) },
		{ start: before, end: new Date(now.getTime() + 300_001), delta: -5, expected: after },
		{ start: before, end: minutesFromNow(5), delta: -5, expected: null },
		{ start: before, end: after, delta: -5, expected: null },
		{ start: before, end: after, delta: 5, expected: new Date(after.getTime() + 300_000) },
		{ start: before, end: now, delta: 5, expected: minutesFromNow(5) },
		{ start: minutesFromNow(-60), end: minutesFromNow(-30), delta: 5, expected: minutesFromNow(5) },
		{ start: before, end: now, delta: -5, expected: null },
		{ start: before, end: before, delta: -5, expected: null },
		{ start: after, end: minutesFromNow(60), delta: 5, expected: null },
		{ start: after, end: minutesFromNow(60), delta: -5, expected: null },
		{ start: null, end: null, delta: 5, expected: null },
		{ start: null, end: null, delta: -5, expected: null },
		{ start: before, end: null, delta: 5, expected: null },
		{ start: before, end: null, delta: -5, expected: null },
	] as const)("shifts or refuses $delta with start $start and end $end", ({ start, end, delta, expected }) => {
		const season = { start, end }
		const original = structuredClone({ season, now })
		expect(shiftEndWindow(season, delta, now)).toEqual(expected ? { start, end: expected } : null)
		expect({ season, now }).toEqual(original)
	})
})

describe("overlappingSeason", () => {
	const other = { _id: "other", start: now, end: minutesFromNow(60) }

	it.each([
		{ start: minutesFromNow(-10), end: now, overlaps: false },
		{ start: minutesFromNow(60), end: minutesFromNow(70), overlaps: false },
		{ start: before, end: after, overlaps: true },
		{ start: new Date(now.getTime() + 3_600_000 - 1), end: minutesFromNow(70), overlaps: true },
		{ start: now, end: minutesFromNow(60), overlaps: true },
		{ start: after, end: minutesFromNow(59), overlaps: true },
		{ start: before, end: minutesFromNow(61), overlaps: true },
		{ start: after, end: after, overlaps: false },
		{ start: null, end: null, overlaps: false },
	])("checks half-open window $start to $end", ({ start, end, overlaps }) => {
		const seasons = [other]
		const window = { start, end }
		const original = structuredClone({ seasons, window })
		expect(overlappingSeason(seasons, "target", window)).toBe(overlaps ? other : null)
		expect({ seasons, window }).toEqual(original)
	})

	it("ignores own season and unscheduled seasons, returning first conflict", () => {
		const own = { ...other, _id: "target" }
		const unscheduled = { _id: "unscheduled", start: null, end: null }
		const second = { ...other, _id: "second" }
		expect(overlappingSeason([own, unscheduled, other, second], "target", other)).toBe(other)
		expect(overlappingSeason([own, unscheduled], "target", other)).toBeNull()
		expect(overlappingSeason([], "target", other)).toBeNull()
	})

	it("treats a started season without an end as open-ended", () => {
		const open = { ...other, end: null }
		expect(overlappingSeason([open], "target", { start: minutesFromNow(120), end: minutesFromNow(180) })).toBe(open)
		expect(overlappingSeason([other], "target", { start: after, end: null })).toBe(other)
	})

	it("ignores empty windows", () => {
		expect(overlappingSeason([{ ...other, end: now }], "target", { start: before, end: after })).toBeNull()
	})
})

describe("liveControls", () => {
	it.each([
		{ start: null, end: null, state: "start", canShrink: false },
		{ start: after, end: minutesFromNow(60), state: "start", canShrink: false },
		{ start: now, end: minutesFromNow(60), state: "live", canShrink: true },
		{ start: before, end: new Date(now.getTime() + 300_001), state: "live", canShrink: true },
		{ start: before, end: minutesFromNow(5), state: "live", canShrink: false },
		{ start: before, end: after, state: "live", canShrink: false },
		{ start: before, end: null, state: "live", canShrink: false },
		{ start: before, end: now, state: "ended", canShrink: false },
		{ start: before, end: before, state: "ended", canShrink: false },
	])("returns $state and canShrink $canShrink for $start to $end", ({ start, end, state, canShrink }) => {
		const season = { start, end, arcs: [] }
		const original = structuredClone({ season, now })
		expect(liveControls(season, now)).toEqual({ state, canShrink, hasQuests: false, incomplete: [] })
		expect({ season, now }).toEqual(original)
	})

	it("finds quests even after empty arcs; empty arcs alone do not count", () => {
		const empty = { id: "a1", title: "Empty", shuffleQuests: false, quests: [] }
		const quest = {
			id: "q1",
			displayTitle: "",
			internalTitle: "",
			content: "",
			assetPath: null,
			answers: [],
			points: null,
			adminNotes: "",
			hints: [],
		}
		const season = { start: null, end: null, arcs: [empty, { ...empty, id: "a2", quests: [quest] }] }
		const original = structuredClone(season)
		expect(liveControls(season, now).hasQuests).toBe(true)
		expect(liveControls({ ...season, arcs: [empty] }, now).hasQuests).toBe(false)
		expect(season).toEqual(original)
	})

	it("returns incomplete hidden drafts without changing the season", () => {
		const season = {
			start: null,
			end: null,
			arcs: [
				{
					id: "a1",
					title: "Arc",
					shuffleQuests: false,
					quests: [
						{
							id: "q1",
							displayTitle: "Draft",
							internalTitle: "",
							content: "",
							assetPath: null,
							answers: [],
							points: null,
							adminNotes: "",
							hints: [],
							hidden: true,
						},
					],
				},
			],
		}
		const original = structuredClone(season)

		expect(liveControls(season, now)).toEqual({
			state: "start",
			canShrink: false,
			hasQuests: false,
			incomplete: [{ id: "q1", label: "Draft", missing: ["content", "answers", "points"] }],
		})
		expect(season).toEqual(original)
	})
})

describe("seasonStatus", () => {
	it.each([
		{ start: null, end: null, status: "unscheduled" },
		{ start: null, end: before, status: "unscheduled" },
		{ start: after, end: null, status: "upcoming" },
		{ start: now, end: null, status: "live" },
		{ start: before, end: null, status: "live" },
		{ start: before, end: after, status: "live" },
		{ start: before, end: now, status: "ended" },
		{ start: before, end: before, status: "ended" },
	])("returns $status for start $start and end $end", ({ start, end, status }) => {
		expect(seasonStatus({ start, end }, now)).toBe(status)
	})
})

describe("groupSeasons", () => {
	it("puts live first, upcoming soonest, unscheduled alphabetically and past newest first without mutation", () => {
		const live = { title: "Live", start: before, end: after }
		const near = { title: "Near", start: after, end: null }
		const far = { title: "Far", start: new Date("2026-11-01T18:00:00Z"), end: null }
		const alpha = { title: "Alpha", start: null, end: null }
		const zulu = { title: "Zulu", start: null, end: null }
		const old = { title: "Old", start: new Date("2025-01-01T18:00:00Z"), end: before }
		const recent = { title: "Recent", start: new Date("2026-01-01T18:00:00Z"), end: before }
		const seasons = [zulu, old, far, alpha, recent, near, live]
		const original = structuredClone(seasons)

		expect(groupSeasons(seasons, now)).toEqual({ current: [live, near, far, alpha, zulu], past: [recent, old] })
		expect(seasons).toEqual(original)
	})

	it("returns empty groups for no seasons", () => {
		expect(groupSeasons([], now)).toEqual({ current: [], past: [] })
	})
})

describe("NewSeasonTitle", () => {
	it.each(["", " \t\n ", "x".repeat(61), null, 123])("rejects invalid title %j", (title) => {
		expect(NewSeasonTitle.safeParse(title).success).toBe(false)
	})

	it("accepts one to sixty characters after trimming", () => {
		expect(NewSeasonTitle.parse(" x ")).toBe("x")
		expect(NewSeasonTitle.parse(` ${"x".repeat(60)} `)).toBe("x".repeat(60))
		expect(NewSeasonTitle.parse("  Cipher Night 2026  ")).toBe("Cipher Night 2026")
	})
})

describe("season date formatters", () => {
	it.each([
		["2026-06-07T17:00:00Z", "Sun 7 Jun 2026, 19:00", "7 Jun", "Jun 2026"],
		["2026-01-11T18:00:00Z", "Sun 11 Jan 2026, 19:00", "11 Jan", "Jan 2026"],
		["2026-10-11T17:00:00Z", "Sun 11 Oct 2026, 19:00", "11 Oct", "Oct 2026"],
		["2026-05-31T22:00:00Z", "Mon 1 Jun 2026, 00:00", "1 Jun", "Jun 2026"],
		["2025-12-31T23:00:00Z", "Thu 1 Jan 2026, 00:00", "1 Jan", "Jan 2026"],
	])("formats %s in Stockholm with English names and 24-hour time", (iso, start, day, month) => {
		const date = new Date(iso)
		expect(formatSeasonStart(date)).toBe(start)
		expect(formatSeasonDay(date)).toBe(day)
		expect(formatSeasonMonth(date)).toBe(month)
	})
})
