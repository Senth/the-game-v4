import { describe, expect, it } from "vitest"
import type { SessionData } from "@/lib/auth/session"
import { allowedChannels, authorizeChannels } from "./channels"

const admin: SessionData = { kind: "admin", id: "a1" }
const teamSession: SessionData = { kind: "team", id: "t1" }
const seasoned = { _id: "t1", seasonId: "s1" }
const unseasoned = { _id: "t1", seasonId: null }

describe("allowedChannels", () => {
	it.each([
		["anonymous", null, null, ["board"]],
		["a team without its record", teamSession, null, ["board"]],
		["a team with a season", teamSession, seasoned, ["team:t1", "board", "season:s1"]],
		["a team without a season", teamSession, unseasoned, ["team:t1", "board"]],
		["an admin", admin, null, "any"],
	] as const)("gives %s %o", (_, session, team, expected) => {
		expect(allowedChannels(session, team)).toEqual(expected)
	})
})

describe("authorizeChannels", () => {
	const anonymous = allowedChannels(null, null)
	const seasonTeam = allowedChannels(teamSession, seasoned)
	const plainTeam = allowedChannels(teamSession, unseasoned)
	const anyChannel = allowedChannels(admin, null)

	it.each([
		["anonymous board", ["board"], anonymous, true],
		["anonymous team", ["team:t1"], anonymous, false],
		["anonymous season", ["season:s1"], anonymous, false],
		["team own channels", ["team:t1", "season:s1", "board"], seasonTeam, true],
		["team without season asking for one", ["season:s1"], plainTeam, false],
		["team own channels without season", ["team:t1", "board"], plainTeam, true],
		["another team's channel", ["team:t1", "team:t2"], seasonTeam, false],
		["another season's channel", ["season:s2"], seasonTeam, false],
		["admin any team and season", ["team:t2", "season:s9", "board"], anyChannel, true],
		["admin malformed prefix", ["teams:t2"], anyChannel, false],
		["admin empty id", ["team:"], anyChannel, false],
		["admin nested channel", ["team:t1:x"], anyChannel, false],
		["admin unknown channel", ["boards"], anyChannel, false],
		["admin one malformed among valid", ["board", "season:"], anyChannel, false],
		["team malformed", ["team:t1 "], seasonTeam, false],
		["admin empty list", [], anyChannel, false],
		["team empty list", [], seasonTeam, false],
		["anonymous empty list", [], anonymous, false],
	] as const)("%s → %s", (_, requested, allowed, expected) => {
		expect(authorizeChannels([...requested], allowed)).toBe(expected)
	})
})
