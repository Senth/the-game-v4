import { describe, expect, it } from "vitest"
import type { SessionData } from "@/lib/auth/session"
import { allowedChannels, authorizeChannels } from "./channels"

const admin: SessionData = { kind: "admin", id: "a1" }
const teamSession: SessionData = { kind: "team", id: "t1" }
const seasoned = { _id: "t1", seasonId: "s1" }

describe("allowedChannels", () => {
	it.each([
		["anonymous", null, null, ["board"]],
		["a team without its record", teamSession, null, ["board"]],
		["a team with a season", teamSession, seasoned, ["team:t1", "board", "season:s1", "positions:t1"]],
		["an admin", admin, null, "any"],
	] as const)("gives %s %o", (_, session, team, expected) => {
		expect(allowedChannels(session, team)).toEqual(expected)
	})
})

describe("authorizeChannels", () => {
	const anonymous = allowedChannels(null, null)
	const seasonTeam = allowedChannels(teamSession, seasoned)
	const anyChannel = allowedChannels(admin, null)

	it.each([
		["anonymous board", ["board"], anonymous, true],
		["anonymous team", ["team:t1"], anonymous, false],
		["anonymous season", ["season:s1"], anonymous, false],
		["team own channels", ["team:t1", "season:s1", "board"], seasonTeam, true],
		["team own positions", ["positions:t1"], seasonTeam, true],
		["another team's positions", ["positions:t2"], seasonTeam, false],
		["anonymous positions", ["positions:t1"], anonymous, false],
		["admin positions", ["positions:t1"], anyChannel, false],
		["admin positions alongside board", ["board", "positions:t1"], anyChannel, false],
		["admin live positions", ["live-positions:s1"], anyChannel, true],
		["anonymous live positions", ["live-positions:s1"], anonymous, false],
		["own-season team live positions", ["live-positions:s1"], seasonTeam, false],
		["other-season team live positions", ["live-positions:s2"], seasonTeam, false],
		["deleted team live positions", ["live-positions:s1"], allowedChannels(teamSession, null), false],
		["deleted team positions", ["positions:t1"], allowedChannels(teamSession, null), false],
		["live positions empty id", ["live-positions:"], anyChannel, false],
		["live positions nested id", ["live-positions:s1:x"], anyChannel, false],
		["live positions trailing space", ["live-positions:s1 "], anyChannel, false],
		["live positions malformed prefix", ["live-position:s1"], anyChannel, false],
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
