"use server"

import { refresh } from "next/cache"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth/guards"
import { NotFoundError } from "@/lib/db/collections"
import {
	removeArc as deleteArc,
	removeQuest as deleteQuest,
	getSeason,
	addArc as insertArc,
	addQuest as insertQuest,
	addQuestToGame as publishQuest,
	moveArc as reorderArc,
	moveQuest as reorderQuest,
} from "@/lib/db/seasons"
import { listSeasonTeams } from "@/lib/db/teams"
import { applyStructuralEdit, type StructuralEdit, type StructuralEditImpact } from "@/lib/domain/game"
import { boardChannel, publish, seasonChannel } from "@/lib/events/bus"
import { type ActionResult, actionFailure } from "./action-result"

const id = z.string().min(1)
const MoveTarget = z.object({ seasonId: id, id, beforeId: id.nullable() }).strict()
const QuestMoveTarget = MoveTarget.extend({ toArcId: id })

export async function moveArc(target: Parameters<typeof reorderArc>[0]): Promise<ActionResult> {
	await requireAdmin()
	const now = new Date()
	try {
		await reorderArc(MoveTarget.parse(target), now)
	} catch (error) {
		return actionFailure(error, now)
	}
	publish(seasonChannel(target.seasonId))
	publish(boardChannel)
	return { ok: true }
}

export async function moveQuest(target: Parameters<typeof reorderQuest>[0]): Promise<ActionResult> {
	await requireAdmin()
	const now = new Date()
	try {
		await reorderQuest(QuestMoveTarget.parse(target), now)
	} catch (error) {
		return actionFailure(error, now)
	}
	publish(seasonChannel(target.seasonId))
	publish(boardChannel)
	return { ok: true }
}

export async function addArc(seasonId: string): Promise<{ ok: true; arcId: string } | { ok: false; error: string }> {
	await requireAdmin()
	const now = new Date()
	let arcId: string
	try {
		arcId = await insertArc(id.parse(seasonId), now)
	} catch (error) {
		return actionFailure(error, now)
	}
	publish(seasonChannel(seasonId))
	publish(boardChannel)
	return { ok: true, arcId }
}

export async function addQuest(
	seasonId: string,
	arcId: string,
): Promise<{ ok: true; questId: string } | { ok: false; error: string }> {
	await requireAdmin()
	const now = new Date()
	let questId: string
	try {
		questId = await insertQuest(id.parse(seasonId), id.parse(arcId), now)
	} catch (error) {
		return actionFailure(error, now)
	}
	publish(seasonChannel(seasonId))
	publish(boardChannel)
	refresh()
	return { ok: true, questId }
}

export async function removeArc(seasonId: string, arcId: string): Promise<ActionResult> {
	await requireAdmin()
	const now = new Date()
	try {
		await deleteArc(id.parse(seasonId), id.parse(arcId), now)
	} catch (error) {
		return actionFailure(error, now)
	}
	return { ok: true }
}

export async function removeQuest(seasonId: string, arcId: string, questId: string): Promise<ActionResult> {
	await requireAdmin()
	const now = new Date()
	try {
		await deleteQuest(id.parse(seasonId), id.parse(arcId), id.parse(questId), now)
	} catch (error) {
		return actionFailure(error, now)
	}
	return { ok: true }
}

export async function addQuestToGame(seasonId: string, arcId: string, questId: string): Promise<ActionResult> {
	await requireAdmin()
	const now = new Date()
	try {
		await publishQuest(id.parse(seasonId), id.parse(arcId), id.parse(questId), now)
	} catch (error) {
		return actionFailure(error, now)
	}
	return { ok: true }
}

type ImpactResult = { ok: true; impact: StructuralEditImpact } | Extract<ActionResult, { ok: false }>

async function readImpact(
	seasonId: string,
	arcId: string,
	target: { kind: "addQuest" | "removeQuest"; questId: string } | null,
): Promise<ImpactResult> {
	const now = new Date()
	try {
		id.parse(seasonId)
		id.parse(arcId)
		const questId = target && id.parse(target.questId)
		const season = await getSeason(seasonId)
		const arc = season?.arcs.find((arc) => arc.id === arcId)
		if (!arc) throw new NotFoundError(`Arc ${arcId} not found`)
		const quests = questId === null ? arc.quests : arc.quests.filter((quest) => quest.id === questId)
		if (questId !== null && !quests.length) throw new NotFoundError(`Quest ${questId} not found`)
		const edit: StructuralEdit =
			target?.kind === "addQuest"
				? { kind: "addQuest", questId: id.parse(questId) }
				: { kind: "deleteQuest", questIds: quests.filter((quest) => !quest.hidden).map((quest) => quest.id) }
		return { ok: true, impact: applyStructuralEdit(await listSeasonTeams(seasonId), edit).impact }
	} catch (error) {
		return actionFailure(error, now)
	}
}

export async function getAddQuestImpact(seasonId: string, arcId: string, questId: string): Promise<ImpactResult> {
	await requireAdmin()
	return readImpact(seasonId, arcId, { kind: "addQuest", questId })
}

export async function getRemoveQuestImpact(seasonId: string, arcId: string, questId: string): Promise<ImpactResult> {
	await requireAdmin()
	return readImpact(seasonId, arcId, { kind: "removeQuest", questId })
}

export async function getRemoveArcImpact(seasonId: string, arcId: string): Promise<ImpactResult> {
	await requireAdmin()
	return readImpact(seasonId, arcId, null)
}
