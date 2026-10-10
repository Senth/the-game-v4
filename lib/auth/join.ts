import { createHmac, timingSafeEqual } from "node:crypto"
import { getTeam } from "@/lib/db/teams"
import type { Team } from "@/lib/domain/schemas"
import { sessionOptions } from "./session"

function signature(team: Team): string {
	return createHmac("sha256", sessionOptions().password)
		.update(JSON.stringify([team._id, team.passwordHash]))
		.digest("base64url")
}

export function joinToken(team: Team): string {
	return `${team._id}.${signature(team)}`
}

export async function verifyJoinToken(token: string): Promise<Team | null> {
	const [matched, id, sig] = /^(.+)\.([A-Za-z0-9_-]{43})$/.exec(token) ?? []
	if (matched !== token || !id || !sig) return null
	const team = await getTeam(id)
	if (!team) return null
	return timingSafeEqual(Buffer.from(sig), Buffer.from(signature(team))) ? team : null
}
