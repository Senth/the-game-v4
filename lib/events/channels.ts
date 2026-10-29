import type { SessionData } from "@/lib/auth/session"
import type { Team } from "@/lib/domain/schemas"
import { boardChannel, positionsChannel, seasonChannel, teamChannel } from "./bus"

const wellFormed = /^(?:board|(?:team|season|positions):[\w-]+)$/

export function allowedChannels(
	session: SessionData | null,
	team: Pick<Team, "_id" | "seasonId"> | null,
): string[] | "any" {
	if (session?.kind === "admin") return "any"
	if (session?.kind !== "team" || !team) return [boardChannel]
	return [teamChannel(team._id), boardChannel, seasonChannel(team.seasonId), positionsChannel(team._id)]
}

export function authorizeChannels(requested: string[], allowed: string[] | "any"): boolean {
	return (
		requested.length > 0 &&
		requested.every(
			(channel) =>
				wellFormed.test(channel) && (allowed === "any" ? !channel.startsWith("positions:") : allowed.includes(channel)),
		)
	)
}
