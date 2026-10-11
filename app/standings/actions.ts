"use server"

import { requireTeam } from "@/lib/auth/guards"
import { loadStandings } from "@/lib/game/game"

export async function getStandings() {
	return loadStandings(await requireTeam())
}
