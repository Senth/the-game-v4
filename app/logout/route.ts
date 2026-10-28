import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { readPhoneId } from "@/lib/auth/phone"
import { getSession } from "@/lib/auth/session"
import { removePhone } from "@/lib/db/phones"

export async function POST(request: Request) {
	const session = await getSession()
	const phoneId = readPhoneId(await cookies())
	if (session.kind === "team" && session.id && phoneId) await removePhone(session.id, phoneId)
	session.destroy()
	return NextResponse.redirect(new URL("/login", request.url), 303)
}
