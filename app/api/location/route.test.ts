import { sealData, unsealData } from "iron-session"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sessionOptions } from "@/lib/auth/session"
import { collections } from "@/lib/db/collections"
import { createSeason } from "@/lib/db/seasons"
import { createTeam } from "@/lib/db/teams"
import type { Team } from "@/lib/domain/schemas"
import { newQuest } from "@/lib/domain/season-tree"
import { latestFixes } from "@/lib/game/location-fixes"
import { proxy } from "@/proxy"
import { useTestDb } from "@/test/db"
import { POST } from "./route"

const jar = vi.hoisted(() => ({ values: new Map<string, string>(), set: vi.fn() }))
vi.mock("next/headers", () => ({
	cookies: async () => ({
		get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name) } : undefined),
		set: jar.set,
	}),
}))

useTestDb()
let team: Team
let seal: string
const report = () => ({ questId: "quest", lat: 56, lng: 13.2353, accuracy: 10, at: Date.now() })

beforeEach(async () => {
	jar.values.clear()
	jar.set.mockReset().mockImplementation((name: string, value: string) => jar.values.set(name, value))
	const db = await collections()
	await db.teams.deleteMany({})
	await db.seasons.deleteMany({})
	await createSeason({
		_id: "season",
		title: "Location",
		lengthMinutes: 60,
		start: new Date(Date.now() - 1000),
		end: new Date(Date.now() + 3_600_000),
		shuffleArcs: false,
		arcs: [
			{
				id: "arc",
				title: "Arc",
				shuffleQuests: false,
				quests: [
					{
						...newQuest(20),
						id: "quest",
						content: "Find it",
						location: { guidance: "none", places: [{ id: "secret-place", lat: 55.5079, lng: 13.2353, radius: 40 }] },
					},
				],
			},
		],
	})
	team = await createTeam({
		name: "Players",
		passwordHash: "hash",
		seasonId: "season",
		questOrder: ["quest"],
		questIndex: 0,
		score: 0,
		completed: false,
		progress: [],
	})
	seal = await sealData({ kind: "team", id: team._id }, sessionOptions())
	jar.values.set(sessionOptions().cookieName, seal)
})

afterEach(() => vi.unstubAllEnvs())

function post(body: unknown = report()) {
	return POST(new Request("https://game.example/api/location", { method: "POST", body: JSON.stringify(body) }))
}

describe("POST /api/location", () => {
	it("gives two phones distinct UUID cookies without changing their shared session", async () => {
		vi.stubEnv("NODE_ENV", "production")
		vi.stubEnv("SESSION_SECRET", "location-test-secret-at-least-32-characters")
		seal = await sealData({ kind: "team", id: team._id }, sessionOptions())
		jar.values.set(sessionOptions().cookieName, seal)
		const response = await post()
		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ status: "outside" })
		const first = jar.values.get("the-game-phone")
		expect(first).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/)
		expect(jar.set).toHaveBeenLastCalledWith("the-game-phone", first, {
			httpOnly: true,
			sameSite: "lax",
			secure: true,
			path: "/",
			maxAge: 400 * 24 * 60 * 60,
		})
		jar.set.mockClear()
		await post()
		expect(jar.set).not.toHaveBeenCalled()
		jar.values.delete("the-game-phone")
		await post()
		expect(jar.values.get("the-game-phone")).not.toBe(first)
		expect(latestFixes(team._id).size).toBe(2)
		expect(jar.values.get(sessionOptions().cookieName)).toBe(seal)
		expect(await unsealData(seal, sessionOptions())).toEqual({ kind: "team", id: team._id })
	})

	it.each(["missing", "admin", "deleted"])("returns 401, not redirects, for %s sessions", async (session) => {
		if (session === "missing") jar.values.clear()
		if (session === "admin")
			jar.values.set(sessionOptions().cookieName, await sealData({ kind: "admin", id: "admin" }, sessionOptions()))
		if (session === "deleted") await (await collections()).teams.deleteOne({ _id: team._id })
		const headers = { cookie: `${sessionOptions().cookieName}=${jar.values.get(sessionOptions().cookieName) ?? ""}` }
		const forwarded = await proxy(new NextRequest("https://game.example/api/location", { headers }))
		expect(forwarded.headers.get("location")).toBeNull()
		const response = await post()
		expect(response.status).toBe(401)
		expect(response.headers.get("location")).toBeNull()
		expect(jar.set).not.toHaveBeenCalled()
	})

	it.each([
		null,
		{},
		{ ...report(), questId: "" },
		{ ...report(), lat: 91 },
		{ ...report(), lng: -181 },
		{ ...report(), accuracy: -1 },
		{ ...report(), at: "now" },
		{ ...report(), lat: "55" },
	])("rejects malformed report %o", async (body) => {
		expect((await post(body)).status).toBe(400)
		expect(jar.set).not.toHaveBeenCalled()
		expect(latestFixes(team._id).size).toBe(0)
	})

	it("rejects invalid JSON and replaces malformed phone ids", async () => {
		expect((await POST(new Request("https://game.example/api/location", { method: "POST", body: "{" }))).status).toBe(
			400,
		)
		jar.values.set("the-game-phone", "not-a-uuid")
		expect((await post()).status).toBe(200)
		expect(jar.values.get("the-game-phone")).not.toBe("not-a-uuid")
	})

	it("returns only solve status and earnings, never place data", async () => {
		const response = await post({ ...report(), lat: 55.5079 })
		expect(await response.json()).toEqual({ status: "solved", pointsEarned: 20 })
	})
})
