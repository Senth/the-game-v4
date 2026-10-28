import { unsealData } from "iron-session"
import { type NextRequest, NextResponse } from "next/server"
import { phoneCookieName, phoneCookieOptions, readPhoneId } from "@/lib/auth/phone"
import { routeFor } from "@/lib/auth/routes"
import { type SessionData, sessionOptions } from "@/lib/auth/session"

export async function proxy(request: NextRequest) {
	const { cookieName, password, ttl } = sessionOptions()
	const seal = request.cookies.get(cookieName)?.value
	const data: Partial<SessionData> = seal
		? await unsealData<Partial<SessionData>>(seal, { password, ttl }).catch(() => ({}))
		: {}
	const session = (data.kind === "admin" || data.kind === "team") && data.id ? { kind: data.kind, id: data.id } : null
	const target = routeFor(request.nextUrl.pathname, session)
	const phoneId = session?.kind === "team" && !readPhoneId(request.cookies) ? crypto.randomUUID() : null
	if (phoneId) request.cookies.set(phoneCookieName, phoneId)
	const response = target ? NextResponse.redirect(new URL(target, request.url)) : NextResponse.next({ request })
	if (phoneId) response.cookies.set(phoneCookieName, phoneId, phoneCookieOptions())
	return response
}
