"use server"

import { z } from "zod"
import { requireAdmin } from "@/lib/auth/guards"
import { NotFoundError } from "@/lib/db/collections"
import {
	getSeason,
	patchSeasonList as patchList,
	RegistrationConflictError,
	type SeasonFieldTarget,
	setSeasonField,
	setSeasonLength,
	setSeasonWindow,
} from "@/lib/db/seasons"
import { NewSeasonTitle, scheduleWindow, seasonStatus } from "@/lib/domain/admin-seasons"
import { Arc, Hint, Quest, Season } from "@/lib/domain/schemas"
import { boardChannel, publish, seasonChannel } from "@/lib/events/bus"
import { type ActionResult, actionFailure } from "./action-result"

const id = z.string().min(1)
const FieldTarget = z.union([
	z.object({ field: Season.omit({ _id: true, arcs: true, registrationOpen: true, end: true }).keyof() }).strict(),
	z.object({ arcId: id, field: Arc.omit({ id: true, quests: true }).keyof() }).strict(),
	z.object({ arcId: id, questId: id, field: Quest.omit({ id: true, answers: true, hints: true }).keyof() }).strict(),
	z.object({ arcId: id, questId: id, hintId: id, field: Hint.omit({ id: true }).keyof() }).strict(),
])
const ListTarget = z.object({ arcId: id, questId: id, field: z.enum(["answers", "hints"]) }).strict()

export async function saveSeasonField(
	seasonId: string,
	target: SeasonFieldTarget,
	value: unknown,
): Promise<ActionResult> {
	await requireAdmin()
	const now = new Date()
	try {
		const parsed = FieldTarget.parse(target)
		id.parse(seasonId)
		if (!("arcId" in parsed) && parsed.field === "start") {
			const start = Season.shape.start.parse(value)
			const season = await getSeason(seasonId)
			if (!season) throw new NotFoundError(`Season ${seasonId} not found`)
			const status = seasonStatus(season, now)
			if (status === "live" || status === "ended") {
				return { ok: false, error: "Set at start. Use −5 / +5 min while live." }
			}
			if (start && start <= now) return { ok: false, error: "Pick a time in the future." }
			await setSeasonWindow(seasonId, season, scheduleWindow(start, season.lengthMinutes), now)
		} else if (!("arcId" in parsed) && parsed.field === "lengthMinutes") {
			await setSeasonLength(seasonId, Season.shape.lengthMinutes.parse(value), now)
		} else {
			await setSeasonField(
				seasonId,
				parsed,
				!("arcId" in parsed) && parsed.field === "title" ? NewSeasonTitle.parse(value) : value,
			)
		}
	} catch (error) {
		return actionFailure(error, now)
	}
	publish(seasonChannel(seasonId))
	publish(boardChannel)
	return { ok: true }
}

export async function patchSeasonList(
	seasonId: string,
	target: Parameters<typeof patchList>[1],
	op: Parameters<typeof patchList>[2],
): Promise<{ ok: boolean }> {
	await requireAdmin()
	try {
		await patchList(id.parse(seasonId), ListTarget.parse(target), op)
	} catch (error) {
		if (error instanceof z.ZodError || error instanceof NotFoundError || error instanceof RegistrationConflictError) {
			return { ok: false }
		}
		throw error
	}
	publish(seasonChannel(seasonId))
	publish(boardChannel)
	return { ok: true }
}
