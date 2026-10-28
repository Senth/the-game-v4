import { sealData, unsealData } from "iron-session"
import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { sessionOptions } from "@/lib/auth/session"
import { proxy } from "./proxy"

afterEach(() => vi.unstubAllEnvs())

describe("phone identity in proxy", () => {
	it.each([undefined, "not-a-uuid"])("replaces %j and forwards cookie to the first render", async (phoneId) => {
		vi.stubEnv("NODE_ENV", "production")
		vi.stubEnv("SESSION_SECRET", "phone-test-secret-at-least-32-characters")
		const seal = await sealData({ kind: "team", id: "team" }, sessionOptions())
		const cookie = `${sessionOptions().cookieName}=${seal}; other=kept${phoneId ? `; the-game-phone=${phoneId}` : ""}`
		const response = await proxy(new NextRequest("https://game.example/", { headers: { cookie } }))
		const phone = response.cookies.get("the-game-phone")
		expect(phone).toMatchObject({
			value: expect.stringMatching(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/),
			httpOnly: true,
			sameSite: "lax",
			secure: true,
			path: "/",
			maxAge: 400 * 24 * 60 * 60,
		})
		const forwarded = new NextRequest("https://game.example/", {
			headers: { cookie: response.headers.get("x-middleware-request-cookie") ?? "" },
		})
		expect(forwarded.cookies.get("the-game-phone")?.value).toBe(phone?.value)
		expect(forwarded.cookies.get("other")?.value).toBe("kept")
		expect(forwarded.cookies.get(sessionOptions().cookieName)?.value).toBe(seal)
		expect(await unsealData(seal, sessionOptions())).toEqual({ kind: "team", id: "team" })
	})

	it("keeps a valid UUID without setting another cookie", async () => {
		const phoneId = crypto.randomUUID()
		const seal = await sealData({ kind: "team", id: "team" }, sessionOptions())
		const request = new NextRequest("https://game.example/", {
			headers: { cookie: `${sessionOptions().cookieName}=${seal}; the-game-phone=${phoneId}` },
		})
		expect((await proxy(request)).cookies.getAll()).toEqual([])
		expect(request.cookies.get("the-game-phone")?.value).toBe(phoneId)
	})

	it.each([null, { kind: "admin", id: "admin" }])("sets no phone cookie for %j", async (session) => {
		const seal = session ? await sealData(session, sessionOptions()) : "invalid-seal"
		const response = await proxy(
			new NextRequest("https://game.example/", {
				headers: { cookie: `${sessionOptions().cookieName}=${seal}` },
			}),
		)
		expect(response.cookies.getAll()).toEqual([])
	})

	it("sets no phone cookie without any session cookie", async () => {
		const response = await proxy(new NextRequest("https://game.example/"))
		expect(response.cookies.getAll()).toEqual([])
		expect(response.headers.get("location")).toBe("https://game.example/login")
	})

	it("uses an insecure cookie only outside production", async () => {
		const seal = await sealData({ kind: "team", id: "team" }, sessionOptions())
		const response = await proxy(
			new NextRequest("http://localhost/", {
				headers: { cookie: `${sessionOptions().cookieName}=${seal}` },
			}),
		)
		expect(response.cookies.get("the-game-phone")?.secure).toBe(false)
	})
})
