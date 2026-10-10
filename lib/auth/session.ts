import { getIronSession, type SessionOptions } from "iron-session"
import { cookies } from "next/headers"

export type SessionData = { kind: "admin" | "team"; id: string }

const devSecret = "the-game-development-session-secret-not-for-production"

export function sessionOptions() {
	const production = process.env.NODE_ENV === "production"
	const secret = process.env.SESSION_SECRET ?? (production ? undefined : devSecret)
	if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters")
	return {
		cookieName: "the-game-session",
		password: secret,
		ttl: 60 * 60 * 24 * 30,
		cookieOptions: { httpOnly: true, sameSite: "lax", secure: production },
	} satisfies SessionOptions
}

export async function getSession() {
	return getIronSession<Partial<SessionData>>(await cookies(), sessionOptions())
}
