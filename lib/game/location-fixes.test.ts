import { describe, expect, it } from "vitest"
import { fixTtlMs, guidanceWindowMs } from "@/lib/domain/location"
import { clearTeamFixes, fixesForTeams, latestFixes, recordFix, recordGuidanceFix, teamFixes } from "./location-fixes"

describe("phone fixes", () => {
	it("reads selected teams with server-clock expiry and copied fixes, pruning just past 30 seconds", () => {
		const now = Date.now()
		const first = crypto.randomUUID()
		const second = crypto.randomUUID()
		const fix = { lat: 55, lng: 13, accuracy: 10, at: now - 1000 }
		recordFix(first, "shared", fix, now)
		recordFix(second, "shared", { ...fix, at: now + 30_000 }, now)
		recordFix("outside", "shared", fix, now)
		expect(fixesForTeams([first, second], now + 100)).toEqual([
			{ teamId: first, phoneId: "shared", fix, expiresInMs: 28_900 },
			{ teamId: second, phoneId: "shared", fix: { ...fix, at: now + 30_000 }, expiresInMs: 29_900 },
		])
		expect(fixesForTeams([], now)).toEqual([])
		const read = fixesForTeams([first], now)[0]
		if (read) read.fix.lat = 0
		expect(fixesForTeams([first], now + 29_000)).toEqual([{ teamId: first, phoneId: "shared", fix, expiresInMs: 0 }])
		expect(fixesForTeams([first], now + 29_001)).toEqual([])
		expect(fixesForTeams([second], now + 30_000)[0]?.expiresInMs).toBe(0)
		expect(fixesForTeams([first, second], now + 30_001)).toEqual([])
	})

	it("keeps only each phone's latest fix, isolated by team, without retaining caller references", () => {
		const now = Date.now()
		const team = crypto.randomUUID()
		const fix = { lat: 55, lng: 13, accuracy: 10, at: now }
		recordFix(team, "one", fix, now)
		recordFix(team, "two", { ...fix, lat: 56 }, now)
		recordFix("other", "one", fix, now)
		recordFix(team, "one", { ...fix, lat: 57, at: now + 1 }, now + 1)
		recordFix(team, "one", fix, now + 2)
		fix.lat = 0
		expect(latestFixes(team, now + 2)).toEqual(
			new Map([
				["one", { lat: 57, lng: 13, accuracy: 10, at: now + 1 }],
				["two", { lat: 56, lng: 13, accuracy: 10, at: now }],
			]),
		)
		const read = latestFixes(team, now + 2).get("one")
		if (read) read.lat = 0
		expect(latestFixes(team, now + 2).get("one")?.lat).toBe(57)
	})

	it("prunes on reads and writes after 30 seconds, including future-dated fixes", () => {
		const now = Date.now()
		const team = crypto.randomUUID()
		const fix = { lat: 55, lng: 13, accuracy: 10, at: now }
		recordFix(team, "one", fix, now)
		recordFix(team, "future", { ...fix, at: now + fixTtlMs }, now)
		expect(latestFixes(team, now + fixTtlMs).size).toBe(2)
		expect(latestFixes(team, now + fixTtlMs + 1).size).toBe(0)
		recordFix(team, "old", fix, now)
		recordFix(team, "new", { ...fix, at: now + fixTtlMs + 1 }, now + fixTtlMs + 1)
		expect([...latestFixes(team, now + fixTtlMs + 1).keys()]).toEqual(["new"])
	})

	it("expires an old fix timestamp despite a fresh receipt", () => {
		const now = Date.now()
		const team = crypto.randomUUID()
		const fix = { lat: 55, lng: 13, accuracy: 10, at: now - fixTtlMs }
		recordFix(team, "phone", fix, now)
		expect(latestFixes(team, now).get("phone")).toEqual(fix)
		expect(latestFixes(team, now + 1).size).toBe(0)
	})

	it("reads phone ids, copied fixes and the older timestamp age for one team", () => {
		const now = Date.now()
		const team = crypto.randomUUID()
		const fix = { lat: 55, lng: 13, accuracy: 10, at: now - 1000 }
		recordFix(team, "old", fix, now)
		recordFix(team, "future", { ...fix, at: now + 1000 }, now)
		recordFix("other", "other", fix, now)
		expect(teamFixes(team, now + 100)).toEqual([
			{ phoneId: "old", fix, ageMs: 1100 },
			{ phoneId: "future", fix: { ...fix, at: now + 1000 }, ageMs: 100 },
		])
		const read = teamFixes(team, now)[0]
		if (read) read.fix.lat = 0
		expect(teamFixes(team, now)[0]?.fix.lat).toBe(55)
		expect(teamFixes(team, now + fixTtlMs)).toHaveLength(1)
		expect(teamFixes(team, now + fixTtlMs + 1)).toEqual([])
	})

	it("clears one team's latest fixes and every phone's guidance history only", () => {
		const now = Date.now()
		const team = crypto.randomUUID()
		const other = crypto.randomUUID()
		const fix = { lat: 55, lng: 13, accuracy: 10, at: now }
		for (const id of [team, other]) {
			for (const phone of ["one", "two"]) {
				recordFix(id, phone, fix, now)
				recordGuidanceFix(id, phone, "quest", fix, now)
			}
		}
		clearTeamFixes(team)
		expect(latestFixes(team, now).size).toBe(0)
		expect(latestFixes(other, now).size).toBe(2)
		for (const phone of ["one", "two"]) {
			expect(recordGuidanceFix(team, phone, "quest", fix, now)).toEqual([])
			expect(recordGuidanceFix(other, phone, "quest", fix, now)).toEqual([fix])
		}
	})
})

describe("guidance history", () => {
	it("returns earlier fixes only, isolates teams and phones, and copies inputs and reads", () => {
		const now = Date.now()
		const team = crypto.randomUUID()
		const fix = { lat: 55, lng: 13, accuracy: 10, at: now }
		expect(recordGuidanceFix(team, "one", "quest", fix, now)).toEqual([])
		fix.lat = 56
		expect(recordGuidanceFix(team, "two", "quest", fix, now)).toEqual([])
		expect(recordGuidanceFix(crypto.randomUUID(), "one", "quest", fix, now)).toEqual([])
		const earlier = recordGuidanceFix(team, "one", "quest", fix, now + 1)
		expect(earlier).toEqual([{ ...fix, lat: 55 }])
		if (earlier[0]) earlier[0].lat = 0
		expect(recordGuidanceFix(team, "one", "quest", fix, now + 2)).toEqual([{ ...fix, lat: 55 }, fix])
	})

	it("resets history on quest changes, without resetting another phone", () => {
		const now = Date.now()
		const team = crypto.randomUUID()
		const fix = { lat: 55, lng: 13, accuracy: 10, at: now }
		recordGuidanceFix(team, "one", "first", fix, now)
		recordGuidanceFix(team, "two", "first", fix, now)
		expect(recordGuidanceFix(team, "one", "next", fix, now)).toEqual([])
		expect(recordGuidanceFix(team, "one", "first", fix, now)).toEqual([])
		expect(recordGuidanceFix(team, "two", "first", fix, now)).toEqual([fix])
	})

	it.each([0, fixTtlMs])("prunes at 60 seconds independently of latest fixes with timestamp offset %s", (offset) => {
		const now = Date.now()
		const team = crypto.randomUUID()
		const fix = { lat: 55, lng: 13, accuracy: 10, at: now + offset }
		recordFix(team, "one", fix, now)
		recordGuidanceFix(team, "one", "quest", fix, now)
		expect(latestFixes(team, now + fixTtlMs + 1).size).toBe(0)
		const fresh = { ...fix, at: now + guidanceWindowMs }
		expect(recordGuidanceFix(team, "one", "quest", fresh, now + guidanceWindowMs)).toEqual([fix])
		expect(recordGuidanceFix(team, "one", "quest", fresh, now + guidanceWindowMs + 1)).toEqual([fresh])
	})

	it("prunes old fix timestamps even when received later", () => {
		const now = Date.now()
		const team = crypto.randomUUID()
		const fix = { lat: 55, lng: 13, accuracy: 10, at: now - fixTtlMs }
		recordGuidanceFix(team, "one", "quest", fix, now)
		expect(recordGuidanceFix(team, "one", "quest", { ...fix, at: now }, now + fixTtlMs + 1)).toEqual([])
	})
})
