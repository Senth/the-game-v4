"use server"

import { cookies } from "next/headers"
import { teamJoinQr } from "@/components/team-qr"
import { requireTeam } from "@/lib/auth/guards"
import { readPhoneId } from "@/lib/auth/phone"
import { ensurePhone, listTeamPhones, renamePhone, touchPhone } from "@/lib/db/phones"
import { PhoneName } from "@/lib/domain/phone-names"
import { type PlayerPhone, playerPhones } from "@/lib/domain/player-game"
import type { Spot } from "@/lib/domain/schemas"
import { publish, seasonChannel, teamChannel } from "@/lib/events/bus"
import {
	dropPuzzlePiece as dropTeamPuzzlePiece,
	getSolvedLocation as getTeamSolvedLocation,
	getSolvedPuzzle as getTeamSolvedPuzzle,
	loadGame,
	revealHint as revealTeamHint,
	submitAnswer as submitTeamAnswer,
} from "@/lib/game/game"

export async function getGame() {
	return loadGame(await requireTeam())
}

export async function setPhoneName(name: string): Promise<{ phones: PlayerPhone[] } | { error: "taken" | "invalid" }> {
	const team = await requireTeam()
	if (typeof name !== "string" || (name.trim() !== "" && !PhoneName.safeParse(name).success))
		return { error: "invalid" }
	const phoneId = readPhoneId(await cookies())
	if (!phoneId) return { error: "invalid" }
	const now = new Date()
	await ensurePhone(team._id, phoneId, now)
	const result = await renamePhone(team._id, phoneId, name)
	if (!result.ok) return { error: result.error }
	publish(teamChannel(team._id))
	publish(seasonChannel(team.seasonId))
	return { phones: playerPhones(await listTeamPhones(team._id), phoneId, now) }
}

export async function pingPhone(): Promise<{ phones: PlayerPhone[] }> {
	const team = await requireTeam()
	const phoneId = readPhoneId(await cookies())
	const now = new Date()
	if (phoneId) {
		await ensurePhone(team._id, phoneId, now)
		await touchPhone(team._id, phoneId, now)
	}
	return { phones: playerPhones(await listTeamPhones(team._id), phoneId, now) }
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

export async function getSolvedLocation(questId: string) {
	return getTeamSolvedLocation(await requireTeam(), questId)
}
