import { z } from "zod"
import { NotFoundError } from "@/lib/db/collections"
import { RegistrationConflictError, SeasonOverlapError, StaleWindowError } from "@/lib/db/seasons"
import { seasonStatus } from "@/lib/domain/admin-seasons"

export type ActionResult = { ok: true } | { ok: false; error: string }

const day = new Intl.DateTimeFormat("en-GB", {
	timeZone: "Europe/Stockholm",
	weekday: "short",
	day: "numeric",
	month: "short",
})
const time = new Intl.DateTimeFormat("en-GB", {
	timeZone: "Europe/Stockholm",
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
})

export function actionFailure(error: unknown, now: Date): ActionResult {
	if (error instanceof SeasonOverlapError) {
		const season = error.season
		return {
			ok: false,
			error:
				seasonStatus(season, now) === "live"
					? `"${season.title}" is live. End it first.`
					: `Overlaps "${season.title}", ${day.format(season.start as Date)} ${time.format(season.start as Date)}–${season.end ? time.format(season.end) : "no end"}.`,
		}
	}
	if (error instanceof z.ZodError) return { ok: false, error: "Invalid value." }
	if (
		error instanceof NotFoundError ||
		error instanceof RegistrationConflictError ||
		error instanceof StaleWindowError ||
		(error instanceof Error && error.message === "Set at start. Use −5 / +5 min while live.")
	) {
		return { ok: false, error: error.message }
	}
	throw error
}
