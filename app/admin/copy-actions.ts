"use server"

import { z } from "zod"
import { withAssetReferences } from "@/lib/assets/release"
import { requireAdmin } from "@/lib/auth/guards"
import { NotFoundError } from "@/lib/db/collections"
import { copyArcToSeason, copyQuestToSeason, getSeason, listSeasons } from "@/lib/db/seasons"
import { copyDestinations, copyArc as duplicateArc, copyQuest as duplicateQuest } from "@/lib/domain/copy"
import { publish, seasonChannel } from "@/lib/events/bus"
import { type ActionResult, actionFailure } from "./action-result"

const id = z.string().min(1)
const QuestDestination = z.union([
	z.object({ seasonId: id, arcId: id }).strict(),
	z.object({ seasonId: id, newArc: z.literal(true) }).strict(),
])
type Failure = Extract<ActionResult, { ok: false }>

export async function getCopyDestinations(
	sourceSeasonId: string,
): Promise<{ ok: true; destinations: ReturnType<typeof copyDestinations> } | Failure> {
	await requireAdmin()
	const now = new Date()
	try {
		id.parse(sourceSeasonId)
		return { ok: true, destinations: copyDestinations(await listSeasons(), sourceSeasonId, now) }
	} catch (error) {
		return actionFailure(error, now)
	}
}

export async function copyArc(
	sourceSeasonId: string,
	arcId: string,
	destSeasonId: string,
): Promise<{ ok: true; seasonId: string; arcId: string } | Failure> {
	await requireAdmin()
	const now = new Date()
	let copiedArcId: string
	try {
		id.parse(sourceSeasonId)
		id.parse(arcId)
		id.parse(destSeasonId)
		if (sourceSeasonId === destSeasonId) return { ok: false, error: "Pick another season." }
		copiedArcId = await withAssetReferences(async () => {
			const source = await getSeason(sourceSeasonId)
			const arc = source?.arcs.find((arc) => arc.id === arcId)
			if (!arc) throw new NotFoundError(`Arc ${arcId} not found`)
			const copied = duplicateArc(arc)
			await copyArcToSeason(destSeasonId, copied)
			return copied.id
		})
	} catch (error) {
		return actionFailure(error, now)
	}
	publish(seasonChannel(destSeasonId))
	return { ok: true, seasonId: destSeasonId, arcId: copiedArcId }
}

export async function copyQuest(
	sourceSeasonId: string,
	questId: string,
	dest: z.infer<typeof QuestDestination>,
): Promise<{ ok: true; seasonId: string; arcId: string; questId: string } | Failure> {
	await requireAdmin()
	const now = new Date()
	let copiedArcId: string
	let copiedQuestId: string
	try {
		id.parse(sourceSeasonId)
		id.parse(questId)
		const target = QuestDestination.parse(dest)
		if (sourceSeasonId === target.seasonId) return { ok: false, error: "Pick another season." }
		;[copiedArcId, copiedQuestId] = await withAssetReferences(async () => {
			const source = await getSeason(sourceSeasonId)
			const arc = source?.arcs.find((arc) => arc.quests.some((quest) => quest.id === questId))
			const quest = arc?.quests.find((quest) => quest.id === questId)
			if (!arc || !quest) throw new NotFoundError(`Quest ${questId} not found`)
			const copied = duplicateQuest(quest)
			const copiedArcId = await copyQuestToSeason(
				target.seasonId,
				"arcId" in target
					? { arcId: target.arcId }
					: { newArc: { title: arc.title, shuffleQuests: arc.shuffleQuests } },
				copied,
			)
			return [copiedArcId, copied.id] as const
		})
	} catch (error) {
		return actionFailure(error, now)
	}
	publish(seasonChannel(dest.seasonId))
	return { ok: true, seasonId: dest.seasonId, arcId: copiedArcId, questId: copiedQuestId }
}
