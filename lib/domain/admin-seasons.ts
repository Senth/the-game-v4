import { z } from "zod"
import { hasEnded } from "./game"
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
