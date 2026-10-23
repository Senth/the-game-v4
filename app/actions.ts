"use server"

import { teamJoinQr } from "@/components/team-qr"
import { requireTeam } from "@/lib/auth/guards"
import type { Spot } from "@/lib/domain/schemas"
import {
	dropPuzzlePiece as dropTeamPuzzlePiece,
	getSolvedPuzzle as getTeamSolvedPuzzle,
	loadGame,
	revealHint as revealTeamHint,
	submitAnswer as submitTeamAnswer,
} from "@/lib/game/game"

export async function getGame() {
	return loadGame(await requireTeam())
}

export async function submitAnswer(questId: string, answer: string) {
	return submitTeamAnswer(await requireTeam(), questId, answer)
}

export async function revealHint(hintId: string) {
	return revealTeamHint(await requireTeam(), hintId)
}

export async function getJoinQr() {
	return teamJoinQr(await requireTeam())
}

export async function dropPuzzlePiece(questId: string, pieceId: string, target: Spot) {
	return dropTeamPuzzlePiece(await requireTeam(), questId, pieceId, target)
}

export async function getSolvedPuzzle(questId: string) {
	return getTeamSolvedPuzzle(await requireTeam(), questId)
}
