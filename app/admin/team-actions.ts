"use server"

import { z } from "zod"
import { requireAdmin } from "@/lib/auth/guards"
import { hashPassword } from "@/lib/auth/password"
import { createSeasonTeam, passwordError } from "@/lib/auth/register"
import { NotFoundError } from "@/lib/db/collections"
import { getSeason } from "@/lib/db/seasons"
import { deleteTeam, getTeam, setTeamField } from "@/lib/db/teams"
import { boardChannel, publish, seasonChannel, teamChannel } from "@/lib/events/bus"
import { type ActionResult, actionFailure } from "./action-result"

const id = z.string().min(1)
const Credentials = z.object({ name: z.string(), password: z.string() })
const errors = {
	"invalid-name": "Team names are 1 to 30 characters.",
	"invalid-password": "Passwords need at least 4 characters.",
}

export type CreateTeamState = { ok?: boolean; error?: string }

export async function createTeamAction(
	seasonId: string,
	_state: CreateTeamState,
	formData: FormData,
): Promise<ActionResult> {
	await requireAdmin()
	const now = new Date()
	try {
		const season = await getSeason(id.parse(seasonId))
		if (!season) throw new NotFoundError(`Season ${seasonId} not found`)
		const { name, password } = Credentials.parse({
			name: formData.get("name") ?? "",
			password: formData.get("password") ?? "",
		})
		const result = await createSeasonTeam(season, name, password, now)
		if (!result.ok) {
			return {
				ok: false,
				error:
					result.error === "taken" ? `${name.trim()} is taken this season. Pick another name.` : errors[result.error],
			}
		}
		return { ok: true }
	} catch (error) {
		return actionFailure(error, now)
	}
}

export async function resetTeamPasswordAction(
	seasonId: string,
	teamId: string,
	_state: CreateTeamState,
	formData: FormData,
): Promise<ActionResult> {
	await requireAdmin()
	const now = new Date()
	try {
		id.parse(seasonId)
		const team = await getTeam(id.parse(teamId))
		if (!team || team.seasonId !== seasonId) throw new NotFoundError(`Team ${teamId} not found`)
		const password = z.string().parse(formData.get("password") ?? "")
		const error = passwordError(password)
		if (error) return { ok: false, error: errors[error] }
		await setTeamField(teamId, "passwordHash", await hashPassword(password))
	} catch (error) {
		return actionFailure(error, now)
	}
	publish(teamChannel(teamId))
	return { ok: true }
}

export async function deleteTeamAction(seasonId: string, teamId: string): Promise<ActionResult> {
	await requireAdmin()
	const now = new Date()
	try {
		id.parse(seasonId)
		const team = await getTeam(id.parse(teamId))
		if (!team || team.seasonId !== seasonId || !(await deleteTeam(teamId))) {
			throw new NotFoundError(`Team ${teamId} not found`)
		}
	} catch (error) {
		return actionFailure(error, now)
	}
	publish(teamChannel(teamId))
	publish(seasonChannel(seasonId))
	publish(boardChannel)
	return { ok: true }
}
