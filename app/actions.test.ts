import { sealData } from "iron-session"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { verifyJoinToken } from "@/lib/auth/join"
import { phoneCookieName } from "@/lib/auth/phone"
import { sessionOptions } from "@/lib/auth/session"
import { collections } from "@/lib/db/collections"
import { ensurePhone, listTeamPhones } from "@/lib/db/phones"
import { createTeam, getTeam, setTeamField } from "@/lib/db/teams"
import { boardChannel, seasonChannel, subscribe, teamChannel } from "@/lib/events/bus"
import { useTestDb } from "@/test/db"
import { getGame, getJoinQr, pingPhone, setPhoneName } from "./actions"
import { POST } from "./logout/route"

const jar = vi.hoisted(() => new Map<string, string>())

vi.mock("next/headers", () => ({
	cookies: async () => ({
		get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
		set: (name: string, value: string) => jar.set(name, value),
	}),
	headers: async () => new Headers({ host: "game.example", "x-forwarded-proto": "https" }),
}))

useTestDb()

beforeEach(async () => {
	await (await collections()).teams.deleteMany({})
	await (await collections()).phones.deleteMany({})
})

afterEach(() => {
	jar.clear()
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
	jar.set(sessionOptions().cookieName, await sealData({ kind: "team", id: team._id }, { password, ttl }))
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

async function signedInTeam(name = "Ninjas") {
	const team = await createTeam({
		name,
		seasonId: "season",
		passwordHash: "hash",
		questOrder: [],
		questIndex: 0,
		score: 0,
		completed: false,
		progress: [],
	})
	const { cookieName, password, ttl } = sessionOptions()
	jar.set(cookieName, await sealData({ kind: "team", id: team._id }, { password, ttl }))
	jar.set(phoneCookieName, crypto.randomUUID())
	return team
}

it("guards phone actions before reads or writes for anonymous, admin and deleted-team sessions", async () => {
	const { cookieName, password, ttl } = sessionOptions()
	for (const data of [null, { kind: "admin", id: "admin" }, { kind: "team", id: "deleted" }]) {
		jar.clear()
		if (data) jar.set(cookieName, await sealData(data, { password, ttl }))
		for (const call of [() => getGame(), () => pingPhone(), () => setPhoneName("Fox")]) {
			await expect(call()).rejects.toMatchObject({ digest: expect.stringContaining(";/login;") })
		}
	}
	expect(await (await collections()).phones.countDocuments()).toBe(0)
})

it("creates and renames only the session team's phone, publishing team and season but not board", async () => {
	const other = await signedInTeam("Other")
	const phoneId = jar.get(phoneCookieName) as string
	await ensurePhone(other._id, phoneId, new Date())
	const team = await signedInTeam()
	jar.set(phoneCookieName, phoneId)
	const events: string[] = []
	const stop = subscribe([teamChannel(team._id), seasonChannel(team.seasonId), boardChannel], ({ channel }) =>
		events.push(channel),
	)
	try {
		const game = await getGame()
		expect(game).toMatchObject({
			lifecycleState: "waiting",
			teamName: team.name,
			phones: [{ name: expect.any(String), you: true }],
		})
		expect(events).toEqual([teamChannel(team._id), seasonChannel(team.seasonId)])
		events.length = 0
		await getGame()
		expect(events).toEqual([])
		const beforeOther = await listTeamPhones(other._id)
		expect(await setPhoneName("  Cafe\u0301 Fox  ")).toEqual({ phones: [{ name: "Café Fox", you: true }] })
		expect(events).toEqual([teamChannel(team._id), seasonChannel(team.seasonId)])
		expect(await listTeamPhones(other._id)).toEqual(beforeOther)
		expect(await setPhoneName("")).toEqual({ phones: [{ name: expect.any(String), you: true }] })
	} finally {
		stop()
	}
})

it("rejects invalid and taken names without publishing or changing the phone", async () => {
	const team = await signedInTeam()
	await getGame()
	const otherId = crypto.randomUUID()
	await ensurePhone(team._id, otherId, new Date())
	const { renamePhone } = await import("@/lib/db/phones")
	await renamePhone(team._id, otherId, "Taken")
	const before = await listTeamPhones(team._id)
	const events: string[] = []
	const stop = subscribe([teamChannel(team._id), seasonChannel(team.seasonId), boardChannel], ({ channel }) =>
		events.push(channel),
	)
	try {
		expect(await setPhoneName("taken")).toEqual({ error: "taken" })
		for (const name of ["x".repeat(21), null, 123, {}]) {
			expect(await setPhoneName(name as string)).toEqual({ error: "invalid" })
		}
		expect(await listTeamPhones(team._id)).toEqual(before)
		expect(events).toEqual([])
	} finally {
		stop()
	}
})

it("pings refresh presence, hide away phones and recreate missing records without events", async () => {
	const team = await signedInTeam()
	const phoneId = jar.get(phoneCookieName) as string
	await ensurePhone(team._id, phoneId, new Date(Date.now() - 700_000))
	await ensurePhone(team._id, crypto.randomUUID(), new Date(Date.now() - 700_000))
	expect(await getGame()).toMatchObject({ phones: [{ name: expect.any(String), you: true }] })
	await (await collections()).phones.updateOne(
		{ teamId: team._id, phoneId },
		{ $set: { lastSeenAt: new Date(Date.now() - 700_000) } },
	)
	const events: string[] = []
	const stop = subscribe([teamChannel(team._id), seasonChannel(team.seasonId), boardChannel], ({ channel }) =>
		events.push(channel),
	)
	try {
		const before = Date.now()
		const result = await pingPhone()
		expect(result).toEqual({ phones: [{ name: expect.any(String), you: true }] })
		const current = (await listTeamPhones(team._id)).find((phone) => phone.phoneId === phoneId)
		expect(current?.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before)
		await (await collections()).phones.deleteMany({ teamId: team._id })
		expect(await pingPhone()).toEqual({ phones: [{ name: expect.any(String), you: true }] })
		expect(await (await collections()).phones.countDocuments({ teamId: team._id })).toBe(1)
		expect(events).toEqual([])
	} finally {
		stop()
	}
})

it("logout removes only the calling phone on its session team before destroying the session", async () => {
	const other = await signedInTeam("Other")
	const team = await signedInTeam()
	const phoneId = jar.get(phoneCookieName) as string
	await ensurePhone(team._id, phoneId, new Date())
	const teammate = await ensurePhone(team._id, crypto.randomUUID(), new Date())
	const elsewhere = await ensurePhone(other._id, phoneId, new Date())
	const response = await POST(new Request("https://game.example/logout", { method: "POST" }))
	expect(response.status).toBe(303)
	expect(response.headers.get("location")).toBe("https://game.example/login")
	expect(await listTeamPhones(team._id)).toEqual([teammate.phone])
	expect(await listTeamPhones(other._id)).toEqual([elsewhere.phone])
	expect(jar.get(sessionOptions().cookieName)).toBe("")
	expect(jar.get(phoneCookieName)).toBe(phoneId)
})

it("admin and anonymous logout leave phone records alone", async () => {
	const team = await signedInTeam()
	await ensurePhone(team._id, jar.get(phoneCookieName) as string, new Date())
	const before = await listTeamPhones(team._id)
	const { cookieName, password, ttl } = sessionOptions()
	for (const data of [null, { kind: "admin", id: team._id }]) {
		jar.delete(cookieName)
		if (data) jar.set(cookieName, await sealData(data, { password, ttl }))
		await POST(new Request("https://game.example/logout", { method: "POST" }))
		expect(await listTeamPhones(team._id)).toEqual(before)
	}
})
