import { cookies } from "next/headers"
import { z } from "zod"
import { phoneCookieName, phoneCookieOptions, readPhoneId } from "@/lib/auth/phone"
import { getSession } from "@/lib/auth/session"
import { getTeam } from "@/lib/db/teams"
import { Place } from "@/lib/domain/schemas"
import { reportPosition } from "@/lib/game/game"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const Report = Place.pick({ lat: true, lng: true })
	.extend({
		questId: z.string().min(1),
		accuracy: z.number().nonnegative(),
		at: z.number(),
	})
	.strict()

export async function POST(request: Request) {
	const { kind, id } = await getSession()
	const team = kind === "team" && id ? await getTeam(id) : null
	if (!team) return new Response(null, { status: 401 })
	const parsed = Report.safeParse(await request.json().catch(() => null))
	if (!parsed.success) return new Response(null, { status: 400 })
	const store = await cookies()
	const existing = readPhoneId(store)
	const phoneId = existing ?? crypto.randomUUID()
	if (!existing) store.set(phoneCookieName, phoneId, phoneCookieOptions())
	const { questId, ...fix } = parsed.data
	return Response.json(await reportPosition(team, phoneId, questId, fix))
}
