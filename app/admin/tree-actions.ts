"use server"

import { z } from "zod"
import { requireAdmin } from "@/lib/auth/guards"
import {
	removeArc as deleteArc,
	removeQuest as deleteQuest,
	addArc as insertArc,
	addQuest as insertQuest,
} from "@/lib/db/seasons"
import { boardChannel, publish, seasonChannel } from "@/lib/events/bus"
import { type ActionResult, actionFailure } from "./action-result"

const id = z.string().min(1)

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
	publish(seasonChannel(seasonId))
	publish(boardChannel)
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
	publish(seasonChannel(seasonId))
	publish(boardChannel)
	return { ok: true }
}
