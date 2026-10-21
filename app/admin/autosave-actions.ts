"use server"

import { z } from "zod"
import { requireAdmin } from "@/lib/auth/guards"
import { NotFoundError } from "@/lib/db/collections"
import {
	addFinisherBonus as addBonus,
	getSeason,
	patchSeasonList as patchList,
	RegistrationConflictError,
	removeLastFinisherBonus as removeBonus,
	moveHint as reorderHint,
	type SeasonFieldTarget,
	setFinisherBonus as setBonus,
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
	z
		.object({
			field: Season.omit({
				_id: true,
				arcs: true,
				registrationOpen: true,
				end: true,
				finisherBonuses: true,
				finishers: true,
			}).keyof(),
		})
		.strict(),
	z.object({ field: z.literal("finisherBonuses"), index: z.string().regex(/^(0|[1-9]\d*)$/) }).strict(),
	z.object({ arcId: id, field: Arc.omit({ id: true, quests: true }).keyof() }).strict(),
	z
		.object({
			arcId: id,
			questId: id,
			field: Quest.omit({ id: true, hidden: true, answers: true, hints: true, assetPath: true }).keyof(),
		})
		.strict(),
	z.object({ arcId: id, questId: id, hintId: id, field: Hint.omit({ id: true }).keyof() }).strict(),
])
const ListTarget = z.object({ arcId: id, questId: id, field: z.enum(["answers", "hints"]) }).strict()
const HintMoveTarget = z.object({ seasonId: id, id, beforeId: id.nullable() }).strict()

export async function addFinisherBonus(seasonId: string, points: number): Promise<ActionResult> {
	await requireAdmin()
	try {
		await addBonus(id.parse(seasonId), points)
	} catch (error) {
		return actionFailure(error, new Date())
	}
	publish(seasonChannel(seasonId))
	publish(boardChannel)
	return { ok: true }
}

export async function setFinisherBonus(seasonId: string, index: number, points: number): Promise<ActionResult> {
	await requireAdmin()
	try {
		await setBonus(id.parse(seasonId), index, points)
	} catch (error) {
		return actionFailure(error, new Date())
	}
	publish(seasonChannel(seasonId))
	publish(boardChannel)
	return { ok: true }
}

export async function removeLastFinisherBonus(
	seasonId: string,
): Promise<{ ok: true; removedIndex: number } | Extract<ActionResult, { ok: false }>> {
	await requireAdmin()
	let removedIndex: number
	try {
		removedIndex = await removeBonus(id.parse(seasonId))
	} catch (error) {
		return actionFailure(error, new Date())
	}
	publish(seasonChannel(seasonId))
	publish(boardChannel)
	return { ok: true, removedIndex }
}

export async function moveHint(target: Parameters<typeof reorderHint>[0]): Promise<ActionResult> {
	await requireAdmin()
	const now = new Date()
	try {
		await reorderHint(HintMoveTarget.parse(target))
	} catch (error) {
		return actionFailure(error, now)
	}
	publish(seasonChannel(target.seasonId))
	publish(boardChannel)
	return { ok: true }
}

export async function saveSeasonField(
	seasonId: string,
	target: SeasonFieldTarget | { field: "finisherBonuses"; index: string },
	value: unknown,
): Promise<ActionResult> {
	await requireAdmin()
	const now = new Date()
	try {
		const parsed = FieldTarget.parse(target)
		id.parse(seasonId)
		if ("index" in parsed) return setFinisherBonus(seasonId, Number(parsed.index), value as number)
		if (
			"questId" in parsed &&
			parsed.field === "points" &&
			!("hintId" in parsed ? Hint.shape.points : Quest.shape.points).safeParse(value).success
		) {
			return { ok: false, error: "Use a whole number from 0 to 10000." }
		}
		if (
			!("arcId" in parsed) &&
			parsed.field === "defaultQuestPoints" &&
			!Season.shape.defaultQuestPoints.safeParse(value).success
		) {
			return { ok: false, error: "Use a whole number from 0 to 10000." }
		}
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
