import { describe, expect, it } from "vitest"
import { fixTtlMs } from "@/lib/domain/location"
import { latestFixes, recordFix } from "./location-fixes"

describe("phone fixes", () => {
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
})
