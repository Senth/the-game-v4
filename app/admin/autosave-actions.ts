"use server"

import { z } from "zod"
import { requireAdmin } from "@/lib/auth/guards"
import { NotFoundError } from "@/lib/db/collections"
import {
	patchSeasonList as patchList,
	RegistrationConflictError,
	type SeasonFieldTarget,
	setSeasonField,
} from "@/lib/db/seasons"
import { NewSeasonTitle } from "@/lib/domain/admin-seasons"
import { Arc, Hint, Quest, Season } from "@/lib/domain/schemas"
import { boardChannel, publish, seasonChannel } from "@/lib/events/bus"

const id = z.string().min(1)
const FieldTarget = z.union([
	z.object({ field: Season.omit({ _id: true, arcs: true, registrationOpen: true }).keyof() }).strict(),
	z.object({ arcId: id, field: Arc.omit({ id: true, quests: true }).keyof() }).strict(),
	z.object({ arcId: id, questId: id, field: Quest.omit({ id: true, answers: true, hints: true }).keyof() }).strict(),
	z.object({ arcId: id, questId: id, hintId: id, field: Hint.omit({ id: true }).keyof() }).strict(),
])
const ListTarget = z.object({ arcId: id, questId: id, field: z.enum(["answers", "hints"]) }).strict()

export async function saveSeasonField(
	seasonId: string,
	target: SeasonFieldTarget,
	value: unknown,
): Promise<{ ok: boolean }> {
	await requireAdmin()
	try {
		const parsed = FieldTarget.parse(target)
		await setSeasonField(
			id.parse(seasonId),
			parsed,
			!("arcId" in parsed) && parsed.field === "title" ? NewSeasonTitle.parse(value) : value,
		)
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
