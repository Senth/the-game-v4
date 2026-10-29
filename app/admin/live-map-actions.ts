"use server"

import { requireAdmin } from "@/lib/auth/guards"
import { type LivePhones, loadLivePhones } from "@/lib/game/live-map"

export async function getLivePhones(seasonId: string): Promise<LivePhones> {
	await requireAdmin()
	return loadLivePhones(seasonId)
}
