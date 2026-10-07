import type { NextRequest } from "next/server"
import { getSession, type SessionData } from "@/lib/auth/session"
import { getAdmin } from "@/lib/db/admins"
import { getTeam } from "@/lib/db/teams"
import { allowedChannels, authorizeChannels } from "@/lib/events/channels"
import { createEventStream } from "@/lib/events/stream"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
	const { kind, id } = await getSession()
	const team = kind === "team" && id ? await getTeam(id) : null
	const admin = kind === "admin" && id ? await getAdmin(id) : null
	const session: SessionData | null = admin
		? { kind: "admin", id: admin._id }
		: team
			? { kind: "team", id: team._id }
			: null
	const channels = request.nextUrl.searchParams.getAll("channel")
	if (!authorizeChannels(channels, allowedChannels(session, team))) return new Response(null, { status: 403 })
	return new Response(createEventStream(channels, request.signal), {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		},
	})
}
