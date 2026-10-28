import { z } from "zod"

export const phoneCookieName = "the-game-phone"

export function readPhoneId(store: { get(name: string): { value: string } | undefined }): string | null {
	const parsed = z.uuid().safeParse(store.get(phoneCookieName)?.value)
	return parsed.success ? parsed.data : null
}

export function phoneCookieOptions() {
	return {
		httpOnly: true,
		sameSite: "lax" as const,
		secure: process.env.NODE_ENV === "production",
		path: "/",
		maxAge: 400 * 24 * 60 * 60,
	}
}
