"use server"

import { z } from "zod"
import { deleteAssetFile, saveAsset } from "@/lib/assets/files"
import { releaseAsset } from "@/lib/assets/release"
import { requireAdmin } from "@/lib/auth/guards"
import { setQuestAsset } from "@/lib/db/seasons"
import { assetExtension, detectAssetExtension, maxAssetBytes, sizeError } from "@/lib/domain/assets"
import { boardChannel, publish, seasonChannel } from "@/lib/events/bus"
import { type ActionResult, actionFailure } from "./action-result"

const id = z.string().min(1)

export async function uploadQuestAsset(
	seasonId: string,
	arcId: string,
	questId: string,
	formData: FormData,
): Promise<{ ok: true; assetPath: string } | { ok: false; error: string }> {
	await requireAdmin()
	const now = new Date()
	let assetPath: string
	try {
		id.parse(seasonId)
		id.parse(arcId)
		id.parse(questId)
		const file = formData.get("file")
		if (!(file instanceof File)) return { ok: false, error: "Not saved, retry" }
		if (file.size > maxAssetBytes) return { ok: false, error: sizeError(file.name, file.size) }
		const bytes = new Uint8Array(await file.arrayBuffer())
		const extension = detectAssetExtension(bytes) ?? assetExtension(file.name)
		assetPath = await saveAsset(bytes, extension)
		let previous: string | null
		try {
			previous = await setQuestAsset(seasonId, arcId, questId, assetPath)
		} catch (error) {
			await deleteAssetFile(assetPath)
			throw error
		}
		if (previous !== assetPath)
			await releaseAsset(previous).catch((error) => console.error("Failed to release asset", previous, error))
	} catch (error) {
		return actionFailure(error, now)
	}
	publish(seasonChannel(seasonId))
	publish(boardChannel)
	return { ok: true, assetPath }
}

export async function removeQuestAsset(seasonId: string, arcId: string, questId: string): Promise<ActionResult> {
	await requireAdmin()
	const now = new Date()
	try {
		const previous = await setQuestAsset(id.parse(seasonId), id.parse(arcId), id.parse(questId), null)
		await releaseAsset(previous).catch((error) => console.error("Failed to release asset", previous, error))
	} catch (error) {
		return actionFailure(error, now)
	}
	publish(seasonChannel(seasonId))
	publish(boardChannel)
	return { ok: true }
}
