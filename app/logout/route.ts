import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"

export async function POST(request: Request) {
	;(await getSession()).destroy()
	return NextResponse.redirect(new URL("/login", request.url), 303)
}
