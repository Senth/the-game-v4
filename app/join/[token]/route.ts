import { NextResponse } from "next/server"
import { verifyJoinToken } from "@/lib/auth/join"
import { ensurePhoneCookie } from "@/lib/auth/phone"
import { getSession } from "@/lib/auth/session"

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
	const team = await verifyJoinToken((await params).token)
	if (!team) return NextResponse.redirect(new URL("/login", request.url), 303)
	const session = await getSession()
	session.kind = "team"
	session.id = team._id
	await ensurePhoneCookie()
	await session.save()
	return NextResponse.redirect(new URL("/", request.url), 303)
}
