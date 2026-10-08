import { sealData } from "iron-session"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createAdmin } from "@/lib/db/admins"
import { collections } from "@/lib/db/collections"
import { createTeam } from "@/lib/db/teams"
import { useTestDb } from "@/test/db"
import { redirectSignedIn, requireAdmin, requireTeam } from "./guards"
import { type SessionData, sessionOptions } from "./session"

const cookie = vi.hoisted(() => ({ value: undefined as string | undefined }))

vi.mock("next/headers", () => ({
	cookies: async () => ({
		get: (name: string) => (cookie.value === undefined ? undefined : { name, value: cookie.value }),
		set: () => {
			throw new Error("guards must not write cookies")
		},
	}),
}))

useTestDb()

afterEach(() => {
	cookie.value = undefined
	vi.unstubAllEnvs()
})

async function login(session: SessionData) {
	const { password, ttl } = sessionOptions()
	cookie.value = await sealData(session, { password, ttl })
}

const toLogin = { digest: expect.stringContaining(";/login;") }

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

describe("guards", () => {
	it("lets an admin cookie through requireAdmin and redirects it from requireTeam", async () => {
		const admin = await createAdmin({ name: "admin", passwordHash: "$2b$10$hash" })
		await login({ kind: "admin", id: admin._id })

		expect(await requireAdmin()).toEqual(admin)
		await expect(requireTeam()).rejects.toMatchObject(toLogin)
	})

	it("lets a team cookie through requireTeam and redirects it from requireAdmin", async () => {
		const ninjas = await team("Ninjas")
		await login({ kind: "team", id: ninjas._id })

		expect(await requireTeam()).toEqual(ninjas)
		await expect(requireAdmin()).rejects.toMatchObject(toLogin)
	})

	it("redirects a deleted team's cookie", async () => {
		const owls = await team("Owls")
		await login({ kind: "team", id: owls._id })
		await (await collections()).teams.deleteOne({ _id: owls._id })

		await expect(requireTeam()).rejects.toMatchObject(toLogin)
	})

	it("redirects with no cookie or a garbage cookie", async () => {
		await expect(requireAdmin()).rejects.toMatchObject(toLogin)
		await expect(requireTeam()).rejects.toMatchObject(toLogin)

		cookie.value = "garbage"
		await expect(requireAdmin()).rejects.toMatchObject(toLogin)
		await expect(requireTeam()).rejects.toMatchObject(toLogin)
	})

	it("redirects a signed-in admin or team away and lets anyone else stay", async () => {
		const admin = await createAdmin({ name: "root", passwordHash: "$2b$10$hash" })
		await login({ kind: "admin", id: admin._id })
		await expect(redirectSignedIn()).rejects.toMatchObject({ digest: expect.stringContaining(";/admin;") })

		const foxes = await team("Foxes")
		await login({ kind: "team", id: foxes._id })
		await expect(redirectSignedIn()).rejects.toMatchObject({ digest: expect.stringContaining(";/;") })

		await (await collections()).teams.deleteOne({ _id: foxes._id })
		await expect(redirectSignedIn()).resolves.toBeUndefined()
		cookie.value = undefined
		await expect(redirectSignedIn()).resolves.toBeUndefined()
	})

	it("throws in production without SESSION_SECRET", async () => {
		vi.stubEnv("NODE_ENV", "production")
		vi.stubEnv("SESSION_SECRET", undefined)

		await expect(requireAdmin()).rejects.toThrow("SESSION_SECRET")
	})
})
