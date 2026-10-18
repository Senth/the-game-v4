"use server"

import { z } from "zod"
import { requireAdmin } from "@/lib/auth/guards"
import { NotFoundError } from "@/lib/db/collections"
import { getSeason, setRegistrationOpen, setSeasonWindow } from "@/lib/db/seasons"
import {
	liveControls,
	seasonStatus,
	shiftEndWindow,
	startCountdownMs,
	startNowWindow,
} from "@/lib/domain/admin-seasons"
import type { Season } from "@/lib/domain/schemas"
import { boardChannel, publish, seasonChannel } from "@/lib/events/bus"
import { type ActionResult, actionFailure } from "./action-result"

const id = z.string().min(1)

async function changeWindow(
	seasonId: string,
	next: (season: Season, now: Date) => Pick<Season, "start" | "end"> | string,
): Promise<ActionResult> {
	const now = new Date()
	try {
		id.parse(seasonId)
		const season = await getSeason(seasonId)
		if (!season) throw new NotFoundError(`Season ${seasonId} not found`)
		const window = next(season, now)
		if (typeof window === "string") return { ok: false, error: window }
		await setSeasonWindow(seasonId, season, window, now)
	} catch (error) {
		return actionFailure(error, now)
	}
	publish(seasonChannel(seasonId))
	publish(boardChannel)
	return { ok: true }
}

export async function startSeasonNow(seasonId: string): Promise<ActionResult> {
	await requireAdmin()
	return changeWindow(seasonId, (season, now) => {
		const controls = liveControls(season, now)
		if (controls.state !== "start") return "Set at start. Use −5 / +5 min while live."
		if (!controls.hasQuests) return "Add a quest first."
		return startNowWindow(season, now, startCountdownMs(process.env.E2E_START_COUNTDOWN_MS))
	})
}

export async function shiftSeasonEnd(seasonId: string, delta: -5 | 5): Promise<ActionResult> {
	await requireAdmin()
	return changeWindow(seasonId, (season, now) => {
		const minutes = z.union([z.literal(-5), z.literal(5)]).parse(delta)
		return shiftEndWindow(season, minutes, now) ?? "Invalid live control."
	})
}

export async function endSeason(seasonId: string): Promise<ActionResult> {
	await requireAdmin()
	return changeWindow(seasonId, (season, now) => {
		if (seasonStatus(season, now) !== "live") return "Invalid live control."
		return { start: season.start, end: now }
	})
}

export async function setSeasonRegistration(seasonId: string, open: boolean): Promise<ActionResult> {
	await requireAdmin()
	const now = new Date()
	try {
		await setRegistrationOpen(id.parse(seasonId), z.boolean().parse(open), now)
	} catch (error) {
		return actionFailure(error, now)
	}
	publish(seasonChannel(seasonId))
	publish(boardChannel)
	return { ok: true }
}
