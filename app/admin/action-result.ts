import { z } from "zod"
import { NotFoundError } from "@/lib/db/collections"
import {
	CopyTargetStartedError,
	FinisherBonusClaimedError,
	MoveConflictError,
	QuestNotReadyError,
	RegistrationConflictError,
	SeasonEndedError,
	SeasonOverlapError,
	SeasonStartedError,
	StaleWindowError,
} from "@/lib/db/seasons"
import { seasonStatus } from "@/lib/domain/admin-seasons"

export type ActionResult = { ok: true } | { ok: false; error: string; conflict?: true }

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

export function actionFailure(error: unknown, now: Date): Extract<ActionResult, { ok: false }> {
	if (error instanceof MoveConflictError) return { ok: false, error: error.message, conflict: true }
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
		error instanceof FinisherBonusClaimedError ||
		error instanceof CopyTargetStartedError ||
		error instanceof RegistrationConflictError ||
		error instanceof SeasonStartedError ||
		error instanceof SeasonEndedError ||
		error instanceof QuestNotReadyError ||
		error instanceof StaleWindowError ||
		(error instanceof Error &&
			["Set at start. Use −5 / +5 min while live.", "Not saved, retry"].includes(error.message))
	) {
		return { ok: false, error: error.message }
	}
	throw error
}
