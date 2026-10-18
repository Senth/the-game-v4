import { z } from "zod"
import { hasEnded } from "./game"
import { incompleteQuests, playableArcs } from "./playable-quests"
import type { Season } from "./schemas"

export const NewSeasonTitle = z.string().trim().min(1).max(60)

export function seasonStatus(
	season: Pick<Season, "start" | "end">,
	now: Date,
): "live" | "upcoming" | "unscheduled" | "ended" {
	if (!season.start) return "unscheduled"
	if (season.start > now) return "upcoming"
	return hasEnded(season, now) ? "ended" : "live"
}

export function scheduleWindow(start: Date | null, lengthMinutes: number): Pick<Season, "start" | "end"> {
	return { start, end: start ? new Date(start.getTime() + lengthMinutes * 60_000) : null }
}

export function startNowWindow(season: Pick<Season, "lengthMinutes">, now: Date): Pick<Season, "start" | "end"> {
	return scheduleWindow(new Date(now.getTime() + 20_000), season.lengthMinutes)
}

export function shiftEndWindow(
	season: Pick<Season, "start" | "end">,
	deltaMinutes: -5 | 5,
	now: Date,
): Pick<Season, "start" | "end"> | null {
	const status = seasonStatus(season, now)
	if (status === "ended" && deltaMinutes === 5) {
		return { start: season.start, end: new Date(now.getTime() + 300_000) }
	}
	if (status !== "live" || !season.end) return null
	if (deltaMinutes === -5 && season.end.getTime() - now.getTime() <= 300_000) return null
	return { start: season.start, end: new Date(season.end.getTime() + deltaMinutes * 60_000) }
}

export function overlappingSeason<T extends Pick<Season, "_id" | "start" | "end">>(
	seasons: readonly T[],
	seasonId: string,
	window: Pick<Season, "start" | "end">,
): T | null {
	if (!window.start) return null
	const start = window.start.getTime()
	const end = window.end?.getTime() ?? Number.POSITIVE_INFINITY
	if (end <= start) return null
	return (
		seasons.find(
			(season) =>
				season._id !== seasonId &&
				season.start !== null &&
				(season.end === null || season.end > season.start) &&
				season.start.getTime() < end &&
				start < (season.end?.getTime() ?? Number.POSITIVE_INFINITY),
		) ?? null
	)
}

export function liveControls(
	season: Pick<Season, "start" | "end" | "arcs">,
	now: Date,
): {
	state: "start" | "live" | "ended"
	canShrink: boolean
	hasQuests: boolean
	incomplete: ReturnType<typeof incompleteQuests>
} {
	const status = seasonStatus(season, now)
	return {
		state: status === "unscheduled" || status === "upcoming" ? "start" : status,
		canShrink: status === "live" && season.end !== null && season.end.getTime() - now.getTime() > 300_000,
		hasQuests: playableArcs(season).some((arc) => arc.quests.length > 0),
		incomplete: incompleteQuests(season),
	}
}

export function groupSeasons<T extends Pick<Season, "title" | "start" | "end">>(
	seasons: readonly T[],
	now: Date,
): { current: T[]; past: T[] } {
	const current: T[] = []
	const past: T[] = []
	for (const season of seasons) {
		;(seasonStatus(season, now) === "ended" ? past : current).push(season)
	}
	const order = { live: 0, upcoming: 1, unscheduled: 2, ended: 3 }
	current.sort((a, b) => {
		const status = seasonStatus(a, now)
		return (
			order[status] - order[seasonStatus(b, now)] ||
			(status === "upcoming"
				? (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0)
				: status === "unscheduled"
					? a.title.localeCompare(b.title, "en")
					: 0)
		)
	})
	past.sort((a, b) => (b.start?.getTime() ?? 0) - (a.start?.getTime() ?? 0))
	return { current, past }
}

const longStart = new Intl.DateTimeFormat("en-GB", {
	timeZone: "Europe/Stockholm",
	weekday: "short",
	day: "numeric",
	month: "short",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
})
const shortDay = new Intl.DateTimeFormat("en-GB", {
	timeZone: "Europe/Stockholm",
	day: "numeric",
	month: "short",
})
const month = new Intl.DateTimeFormat("en-GB", {
	timeZone: "Europe/Stockholm",
	month: "short",
	year: "numeric",
})

export const formatSeasonStart = (date: Date): string => longStart.format(date).replace(",", "")
export const formatSeasonDay = (date: Date): string => shortDay.format(date)
export const formatSeasonMonth = (date: Date): string => month.format(date)
