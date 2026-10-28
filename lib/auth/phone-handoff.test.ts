import { unsealData } from "iron-session"
import { NextRequest } from "next/server"
import { beforeAll, beforeEach, expect, it, vi } from "vitest"
import { getGame } from "@/app/actions"
import { GET } from "@/app/join/[token]/route"
import { login } from "@/app/login/actions"
import { POST } from "@/app/logout/route"
import { register } from "@/app/register/actions"
import { collections } from "@/lib/db/collections"
import { listTeamPhones } from "@/lib/db/phones"
import { createSeason, setRegistrationOpen } from "@/lib/db/seasons"
import { createTeam, getTeam } from "@/lib/db/teams"
import { proxy } from "@/proxy"
import { useTestDb } from "@/test/db"
import { joinToken } from "./join"
import { hashPassword } from "./password"
import { phoneCookieName, readPhoneId } from "./phone"
import { sessionOptions } from "./session"

const jar = vi.hoisted(() => new Map<string, string>())

vi.mock("next/headers", () => ({
	cookies: async () => ({
		get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
		set: (name: string, value: string) => jar.set(name, value),
	}),
}))

useTestDb()

let passwordHash: string

beforeAll(async () => {
	passwordHash = await hashPassword("ninjas")
	await createSeason({
		_id: "season",
		title: "Phone handoff",
		lengthMinutes: 60,
		start: null,
		end: null,
		shuffleArcs: false,
		arcs: [],
	})
	await setRegistrationOpen("season", true)
})

beforeEach(async () => {
	jar.clear()
	const { teams, phones } = await collections()
	await teams.deleteMany({})
	await phones.deleteMany({})
})

it.each([
	["password", "missing"],
	["registration", "missing"],
	["QR", "missing"],
	["password", "malformed"],
	["password", "valid"],
])("establishes one phone before the %s login redirect renders with a %s cookie", async (entry, cookie) => {
	let team = await createTeam({
		name: "Ninjas",
		passwordHash,
		seasonId: "season",
		questOrder: [],
		questIndex: 0,
		score: 0,
		completed: false,
		progress: [],
	})
	const identities: string[] = []
	const contexts: { cookies: Map<string, string>; teamId: string }[] = []
	for (let phone = 0; phone < 2; phone++) {
		jar.clear()
		const existingId = cookie === "valid" ? crypto.randomUUID() : cookie === "malformed" ? "not-a-uuid" : null
		if (existingId) jar.set(phoneCookieName, existingId)
		const form = new FormData()
		form.set("name", entry === "registration" ? `Registered ${phone}` : "Ninjas")
		form.set("password", "ninjas")
		if (entry === "QR") {
			const token = joinToken(team)
			expect(
				(await GET(new Request(`https://game.example/join/${token}`), { params: Promise.resolve({ token }) })).status,
			).toBe(303)
		} else {
			await expect(entry === "password" ? login({}, form) : register({}, form)).rejects.toMatchObject({
				digest: expect.stringContaining(";/;"),
			})
		}
		const phoneId = readPhoneId({ get: (name) => ({ value: jar.get(name) ?? "" }) })
		expect(phoneId).not.toBeNull()
		if (cookie === "valid") expect(phoneId).toBe(existingId)
		identities.push(phoneId as string)
		const seal = jar.get(sessionOptions().cookieName) as string
		const session = await unsealData<{ kind: string; id: string }>(seal, sessionOptions())
		expect(Object.keys(session).sort()).toEqual(["id", "kind"])
		if (entry === "registration") {
			const registered = await getTeam(session.id)
			if (!registered) throw new Error("Registered team missing")
			team = registered
		}
		expect(session).toEqual({ kind: "team", id: team._id })
		const firstRender = await getGame()
		expect(firstRender).toHaveProperty("phones.0", { name: expect.any(String), you: true })
		const response = await proxy(
			new NextRequest("https://game.example/", {
				headers: { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") },
			}),
		)
		expect(response.cookies.getAll()).toEqual([])
		expect(await getGame()).toEqual(firstRender)
		const phones = await listTeamPhones(team._id)
		expect(phones).toHaveLength(entry === "registration" ? 1 : phone + 1)
		expect(phones).toContainEqual(expect.objectContaining({ phoneId }))
		contexts.push({ cookies: new Map(jar), teamId: team._id })
	}
	expect(new Set(identities).size).toBe(2)
	for (const context of contexts) {
		jar.clear()
		for (const [name, value] of context.cookies) jar.set(name, value)
		await POST(new Request("https://game.example/logout", { method: "POST" }))
		expect(await listTeamPhones(context.teamId)).not.toContainEqual(
			expect.objectContaining({ phoneId: jar.get(phoneCookieName) }),
		)
		expect(jar.get(phoneCookieName)).toBe(context.cookies.get(phoneCookieName))
	}
	expect(await (await collections()).phones.countDocuments()).toBe(0)
})
