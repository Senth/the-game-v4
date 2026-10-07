import { getAdminByName } from "@/lib/db/admins"
import { listSeasons } from "@/lib/db/seasons"
import { listTeamsByName } from "@/lib/db/teams"
import { pickLoginTeam } from "@/lib/domain/game"
import { verifyPassword } from "./password"
import type { SessionData } from "./session"

const dummyHash = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8DPLKXt1FYlwYpQW4JXkPw5fOg5ARK"

export async function authenticate(name: string, password: string, now = new Date()): Promise<SessionData | null> {
	const trimmed = name.trim()
	const [admin, teams] = await Promise.all([getAdminByName(trimmed), listTeamsByName(trimmed)])
	if (admin && (await verifyPassword(password, admin.passwordHash))) return { kind: "admin", id: admin._id }
	if (!admin && teams.length === 0) {
		await verifyPassword(password, dummyHash)
		return null
	}
	const verified = await Promise.all(teams.map((team) => verifyPassword(password, team.passwordHash)))
	const team = pickLoginTeam(
		teams.filter((_, i) => verified[i]),
		await listSeasons(),
		now,
	)
	return team && { kind: "team", id: team._id }
}
