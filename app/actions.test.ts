import { sealData } from "iron-session"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { verifyJoinToken } from "@/lib/auth/join"
import { sessionOptions } from "@/lib/auth/session"
import { collections } from "@/lib/db/collections"
import { createTeam, getTeam, setTeamField } from "@/lib/db/teams"
import { useTestDb } from "@/test/db"
import { getJoinQr } from "./actions"

const cookie = vi.hoisted(() => ({ value: undefined as string | undefined }))

vi.mock("next/headers", () => ({
	cookies: async () => ({
		get: (name: string) => (cookie.value === undefined ? undefined : { name, value: cookie.value }),
	}),
	headers: async () => new Headers({ host: "game.example", "x-forwarded-proto": "https" }),
}))

useTestDb()

beforeEach(async () => {
	await (await collections()).teams.deleteMany({})
})

afterEach(() => {
	cookie.value = undefined
})

const token = (url: string) => decodeURIComponent(new URL(url).pathname.slice("/join/".length))

it("redirects to login without a team session", async () => {
	await expect(getJoinQr()).rejects.toMatchObject({ digest: expect.stringContaining(";/login;") })
})

it("returns only the url and svg, signed with the team's current password hash", async () => {
	const team = await createTeam({
		name: "Ninjas",
		seasonId: "season",
		passwordHash: "old-password-hash",
		questOrder: [],
		questIndex: 0,
		score: 0,
		completed: false,
		progress: [],
	})
	const { password, ttl } = sessionOptions()
	cookie.value = await sealData({ kind: "team", id: team._id }, { password, ttl })
	const before = await getJoinQr()
	expect(Object.keys(before)).toEqual(["url", "svg"])
	expect(before.url).toMatch(/^https:\/\/game\.example\/join\//)

	await setTeamField(team._id, "passwordHash", "new-password-hash")
	const after = await getJoinQr()
	expect(after.url).not.toBe(before.url)
	expect(after.svg).not.toBe(before.svg)
	expect(await verifyJoinToken(token(before.url))).toBeNull()
	expect(await verifyJoinToken(token(after.url))).toEqual(await getTeam(team._id))
	expect(JSON.stringify(after)).not.toContain("new-password-hash")
})
