import { describe, expect, it } from "vitest"
import { routeFor } from "./routes"
import type { SessionData } from "./session"

const admin: SessionData = { kind: "admin", id: "a1" }
const team: SessionData = { kind: "team", id: "t1" }

describe("routeFor", () => {
	it.each([
		["/login", null, null],
		["/login", team, null],
		["/login", admin, null],
		["/logout", admin, null],
		["/logout", team, null],
		["/register", null, null],
		["/board", null, null],
		["/board", admin, null],
		["/assets/q1/map.png", null, null],
		["/_next/static/chunk.js", null, null],
		["/icon.svg", null, null],
		["/favicon.ico", null, null],
		["/", null, "/login"],
		["/admin", null, "/login"],
		["/standings", null, "/login"],
		["/assets", null, "/login"],
		["/", team, null],
		["/standings", team, null],
		["/admin", team, "/"],
		["/admin/seasons/s1", team, "/"],
		["/administrator", team, null],
		["/admin", admin, null],
		["/admin/seasons/s1", admin, null],
		["/", admin, "/admin"],
		["/standings", admin, "/admin"],
		["/administrator", admin, "/admin"],
	] as const)("%s with %o goes to %s", (pathname, session, expected) => {
		expect(routeFor(pathname, session)).toBe(expected)
	})
})
