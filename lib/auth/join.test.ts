import { createHmac } from "node:crypto"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { GET } from "@/app/join/[token]/route"
import { collections } from "@/lib/db/collections"
import { createTeam, setTeamField } from "@/lib/db/teams"
import type { Team } from "@/lib/domain/schemas"
import { useTestDb } from "@/test/db"
import { joinToken, verifyJoinToken } from "./join"
import { getSession, type SessionData, sessionOptions } from "./session"

const session = vi.hoisted(() => ({ kind: "admin" as SessionData["kind"], id: "a1", save: vi.fn() }))

vi.mock("./session", async (importOriginal) => ({
	...(await importOriginal<typeof import("./session")>()),
	getSession: vi.fn(async () => session),
}))

useTestDb()

function team(name: string) {
	return createTeam({
		name,
		passwordHash: "$2b$10$hash",
		seasonId: null,
		questOrder: [],
		questIndex: 0,
		score: 0,
		completed: false,
		progress: [],
	})
}

let ninjas: Team

beforeAll(async () => {
	ninjas = await team("Ninjas")
})

beforeEach(() => {
	session.kind = "admin"
	session.id = "a1"
	vi.clearAllMocks()
})

afterEach(() => vi.unstubAllEnvs())

describe("join tokens", () => {
	it("signs the team id and password hash with the session secret and verifies the token", async () => {
		vi.stubEnv("SESSION_SECRET", "join-test-session-secret-at-least-32-characters")
		const signature = createHmac("sha256", sessionOptions().password)
			.update(JSON.stringify([ninjas._id, ninjas.passwordHash]))
			.digest("base64url")
		expect(joinToken(ninjas)).toBe(`${ninjas._id}.${signature}`)
		expect(await verifyJoinToken(joinToken(ninjas))).toEqual(ninjas)
	})

	it("rejects a token after the password changes", async () => {
		const owls = await team("Owls")
		const token = joinToken(owls)
		await setTeamField(owls._id, "passwordHash", "$2b$10$changed")
		expect(await verifyJoinToken(token)).toBeNull()
	})

	it("rejects another team's signature", async () => {
		const foxes = await team("Foxes")
		const signature = joinToken(foxes).split(".")[1]
		expect(await verifyJoinToken(`${ninjas._id}.${signature}`)).toBeNull()
	})

	it("rejects a deleted team's token", async () => {
		const bears = await team("Bears")
		const token = joinToken(bears)
		await (await collections()).teams.deleteOne({ _id: bears._id })
		expect(await verifyJoinToken(token)).toBeNull()
	})

	it("rejects trailing characters on an otherwise valid token", async () => {
		expect(await verifyJoinToken(`${joinToken(ninjas)}\n`)).toBeNull()
	})

	it.each(["", "missing-dot", ".signature", "t1.", "t1.short", `t1.${"!".repeat(43)}`])(
		"rejects malformed token %s without throwing",
		async (token) => expect(await verifyJoinToken(token)).toBeNull(),
	)

	it("uses the production session secret requirement", () => {
		vi.stubEnv("NODE_ENV", "production")
		vi.stubEnv("SESSION_SECRET", undefined)
		expect(() => joinToken(ninjas)).toThrow("SESSION_SECRET must be at least 32 characters")
	})
})

describe("GET /join/[token]", () => {
	it("replaces an admin session with only the joined team identity and redirects home", async () => {
		const token = joinToken(ninjas)
		const response = await GET(new Request(`https://game.example/join/${token}?next=/admin`), {
			params: Promise.resolve({ token }),
		})
		expect({ kind: session.kind, id: session.id }).toEqual({ kind: "team", id: ninjas._id })
		expect(session.save).toHaveBeenCalledOnce()
		expect(response.status).toBe(303)
		expect(response.headers.get("location")).toBe("https://game.example/")
	})

	it("redirects a tampered signature to login without changing the existing session", async () => {
		const token = `${ninjas._id}.${"A".repeat(43)}`
		expect(await verifyJoinToken(token)).toBeNull()
		const response = await GET(new Request(`https://game.example/join/${token}`), {
			params: Promise.resolve({ token }),
		})
		expect(getSession).not.toHaveBeenCalled()
		expect(session).toMatchObject({ kind: "admin", id: "a1" })
		expect(session.save).not.toHaveBeenCalled()
		expect(response.status).toBe(303)
		expect(response.headers.get("location")).toBe("https://game.example/login")
	})
})
