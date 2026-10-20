import { MongoServerError } from "mongodb"
import { listSeasons } from "@/lib/db/seasons"
import { createTeam } from "@/lib/db/teams"
import { buildQuestOrder, registrationSeason } from "@/lib/domain/game"
import type { Season, Team } from "@/lib/domain/schemas"
import { boardChannel, publish, seasonChannel } from "@/lib/events/bus"
import { hashPassword } from "./password"

type CreateTeamResult = { ok: true; team: Team } | { ok: false; error: "invalid-name" | "invalid-password" | "taken" }

export type RegisterResult = CreateTeamResult | { ok: false; error: "closed" }

export function passwordError(password: string) {
	return password.length < 4 ? "invalid-password" : null
}

function credentialsError(name: string, password: string) {
	if (name.trim().length < 1 || name.trim().length > 30) return "invalid-name"
	return passwordError(password)
}

export async function registerTeam(name: string, password: string, now = new Date()): Promise<RegisterResult> {
	const error = credentialsError(name, password)
	if (error) return { ok: false, error }
	const season = registrationSeason(await listSeasons(), now)
	if (!season) return { ok: false, error: "closed" }
	return createSeasonTeam(season, name, password, now)
}

export async function createSeasonTeam(
	season: Season,
	name: string,
	password: string,
	now: Date,
): Promise<CreateTeamResult> {
	const error = credentialsError(name, password)
	if (error) return { ok: false, error }
	try {
		const team = await createTeam({
			name: name.trim(),
			passwordHash: await hashPassword(password),
			seasonId: season._id,
			questOrder: season.start && season.start <= now ? buildQuestOrder(season) : [],
			...(season.start && season.start <= now ? { reachedAt: now } : {}),
			questIndex: 0,
			score: 0,
			completed: false,
			progress: [],
		})
		publish(seasonChannel(season._id))
		publish(boardChannel)
		return { ok: true, team }
	} catch (error) {
		if (error instanceof MongoServerError && error.code === 11000) return { ok: false, error: "taken" }
		throw error
	}
}
