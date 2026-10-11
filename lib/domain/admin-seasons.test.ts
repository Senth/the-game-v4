import { describe, expect, it } from "vitest"
import {
	formatSeasonDay,
	formatSeasonMonth,
	formatSeasonStart,
	groupSeasons,
	NewSeasonTitle,
	seasonStatus,
} from "./admin-seasons"

const now = new Date("2026-10-11T17:00:00Z")
const before = new Date(now.getTime() - 1)
const after = new Date(now.getTime() + 1)

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
