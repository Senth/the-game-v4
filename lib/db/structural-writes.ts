import { releaseAsset } from "@/lib/assets/release"
import type { StructuralEdit } from "@/lib/domain/game"
import { boardChannel, publish, seasonChannel } from "@/lib/events/bus"
import { collections } from "./collections"
import { editSeasonTeamOrders } from "./teams"

export type PendingStructure = { target: string; edit: StructuralEdit | null; assetPaths: string[] }

const cache = globalThis as typeof globalThis & { theGameStructure?: Map<string, Promise<void>> }
cache.theGameStructure ??= new Map()
const writes = cache.theGameStructure

export async function withSeasonStructure<T>(seasonId: string, work: () => Promise<T>): Promise<T> {
	const previous = writes.get(seasonId)
	const next = Promise.withResolvers<void>()
	writes.set(seasonId, next.promise)
	await previous
	try {
		return await work()
	} finally {
		next.resolve()
		if (writes.get(seasonId) === next.promise) writes.delete(seasonId)
	}
}

export async function finishSeasonStructure(seasonId: string) {
	const { seasons } = await collections()
	const pending = (await seasons.findOne({ _id: seasonId }))?.pendingStructure
	if (!pending) return null
	try {
		const affected = pending.edit ? await editSeasonTeamOrders(seasonId, pending.edit) : []
		for (const assetPath of pending.assetPaths) {
			await releaseAsset(assetPath).catch((error) => console.error("Failed to release asset", assetPath, error))
		}
		await seasons.updateOne({ _id: seasonId }, { $unset: { pendingStructure: "" } })
		return { ...pending, affected }
	} finally {
		publish(seasonChannel(seasonId))
		publish(boardChannel)
	}
}
