import { sealData } from "iron-session"
import { NextRequest } from "next/server"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { type SessionData, sessionOptions } from "@/lib/auth/session"
import { createAdmin } from "@/lib/db/admins"
import { collections } from "@/lib/db/collections"
import { createSeason } from "@/lib/db/seasons"
import { createTeam, deleteTeam } from "@/lib/db/teams"
import { useTestDb } from "@/test/db"
import { GET } from "./route"

const cookie = vi.hoisted(() => ({ value: undefined as string | undefined }))
vi.mock("next/headers", () => ({
	cookies: async () => ({ get: () => (cookie.value === undefined ? undefined : { value: cookie.value }) }),
}))

useTestDb()

let seasonId: string
let teamId: string
let otherTeamId: string
let deletedTeamId: string
let adminId: string
let deletedAdminId: string

beforeAll(async () => {
	const season = await createSeason({
		title: "Events",
		lengthMinutes: 60,
		start: null,
		end: null,
		shuffleArcs: false,
		arcs: [],
	})
	seasonId = season._id
	const team = {
		passwordHash: "hash",
		seasonId,
		questOrder: [],
		questIndex: 0,
		score: 0,
		completed: false,
		progress: [],
	}
	teamId = (await createTeam({ ...team, name: "Current" }))._id
	otherTeamId = (await createTeam({ ...team, name: "Other" }))._id
	deletedTeamId = (await createTeam({ ...team, name: "Deleted" }))._id
	await deleteTeam(deletedTeamId)
	adminId = (await createAdmin({ name: "Admin", passwordHash: "hash" }))._id
	deletedAdminId = (await createAdmin({ name: "Deleted admin", passwordHash: "hash" }))._id
	await (await collections()).admins.deleteOne({ _id: deletedAdminId })
})

beforeEach(() => {
	cookie.value = undefined
})

async function login(session: SessionData) {
	const { password, ttl } = sessionOptions()
	cookie.value = await sealData(session, { password, ttl })
}

async function request(channels: string[]) {
	const url = new URL("http://localhost/api/events")
	for (const channel of channels) url.searchParams.append("channel", channel)
	const controller = new AbortController()
	const response = await GET(new NextRequest(url, { signal: controller.signal }))
	if (response.status === 200) controller.abort()
	return response
}

async function expectStream(channels: string[]) {
	const response = await request(channels)
	expect(response.status).toBe(200)
	expect(response.headers.get("content-type")).toBe("text/event-stream")
}

describe("GET /api/events", () => {
	it("allows board without a session", async () => {
		await expectStream(["board"])
	})

	it("rejects a team channel without a session", async () => {
		expect((await request([`team:${teamId}`])).status).toBe(403)
	})

	it("allows a team its own team, season and board channels", async () => {
		await login({ kind: "team", id: teamId })
		for (const channel of [`team:${teamId}`, `season:${seasonId}`, "board"]) await expectStream([channel])
	})

	it("rejects another team's channel", async () => {
		await login({ kind: "team", id: teamId })
		expect((await request([`team:${otherTeamId}`])).status).toBe(403)
	})

	it("allows only the owning team to subscribe to positions, never admins", async () => {
		expect((await request([`positions:${teamId}`])).status).toBe(403)
		await login({ kind: "team", id: otherTeamId })
		expect((await request([`positions:${teamId}`])).status).toBe(403)
		await login({ kind: "admin", id: adminId })
		expect((await request(["board", `positions:${teamId}`])).status).toBe(403)
		await login({ kind: "team", id: teamId })
		await expectStream([`positions:${teamId}`, `team:${teamId}`, "board"])
	})

	it("rejects a deleted team's channel but allows board", async () => {
		await login({ kind: "team", id: deletedTeamId })
		expect((await request([`team:${deletedTeamId}`])).status).toBe(403)
		await expectStream(["board"])
	})

	it("allows an admin another team's channel and a season channel", async () => {
		await login({ kind: "admin", id: adminId })
		await expectStream([`team:${otherTeamId}`])
		await expectStream([`season:${seasonId}`])
	})

	it("rejects a deleted admin's season channel but allows board", async () => {
		await login({ kind: "admin", id: deletedAdminId })
		expect((await request([`season:${seasonId}`])).status).toBe(403)
		await expectStream(["board"])
	})
})
