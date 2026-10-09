"use server"

import { requireTeam } from "@/lib/auth/guards"
import { loadGame, revealHint as revealTeamHint, submitAnswer as submitTeamAnswer } from "@/lib/game/game"

export async function getGame() {
	return loadGame(await requireTeam())
}

export async function submitAnswer(questId: string, answer: string) {
	return submitTeamAnswer(await requireTeam(), questId, answer)
}

export async function revealHint(hintId: string) {
	return revealTeamHint(await requireTeam(), hintId)
}
