import { MongoServerError } from "mongodb"
import { listSeasons } from "@/lib/db/seasons"
import { createTeam } from "@/lib/db/teams"
import { buildQuestOrder, registrationSeason } from "@/lib/domain/game"
import type { Team } from "@/lib/domain/schemas"
import { boardChannel, publish, seasonChannel } from "@/lib/events/bus"
import { hashPassword } from "./password"

export type RegisterResult =
	| { ok: true; team: Team }
	| { ok: false; error: "invalid-name" | "invalid-password" | "closed" | "taken" }

export async function registerTeam(name: string, password: string, now = new Date()): Promise<RegisterResult> {
	const trimmed = name.trim()
	const length = [...trimmed].length
	if (length < 1 || length > 30) return { ok: false, error: "invalid-name" }
	if ([...password].length < 4) return { ok: false, error: "invalid-password" }
	const season = registrationSeason(await listSeasons(), now)
	if (!season) return { ok: false, error: "closed" }
	try {
		const team = await createTeam({
			name: trimmed,
			passwordHash: await hashPassword(password),
			seasonId: season._id,
			questOrder: season.start && season.start <= now ? buildQuestOrder(season) : [],
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
