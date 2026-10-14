import type { Filter, UpdateFilter } from "mongodb"
import { z } from "zod"
import { overlappingSeason, scheduleWindow, seasonStatus } from "@/lib/domain/admin-seasons"
import { hasEnded, normalizeAnswer, registrationConflict } from "@/lib/domain/game"
import { Arc, Hint, HintInput, Quest, Season, type SeasonInput, withHintIds } from "@/lib/domain/schemas"
import { newArc, newQuest } from "@/lib/domain/season-tree"
import { collections, NotFoundError } from "./collections"

type Field<T> = Exclude<keyof T, "_id" | "id">

export type SeasonFieldTarget =
	| { field: Field<Season> }
	| { arcId: string; field: Field<Arc> }
	| { arcId: string; questId: string; field: Field<Quest> }
	| { arcId: string; questId: string; hintId: string; field: Field<Hint> }

const Hints = z
	.array(HintInput)
	.transform((hints) => hints.map((hint) => ({ ...hint, id: hint.id ?? crypto.randomUUID() })))

export async function createSeason(
	input: Omit<SeasonInput, "_id" | "registrationOpen"> & { _id?: string },
): Promise<Season> {
	const season = Season.parse(withHintIds({ ...input, _id: input._id ?? crypto.randomUUID(), registrationOpen: false }))
	await (await collections()).seasons.insertOne(season)
	return season
}

export async function getSeason(id: string): Promise<Season | null> {
	return (await collections()).seasons.findOne({ _id: id })
}

export async function listSeasons(): Promise<Season[]> {
	return (await collections()).seasons.find().toArray()
}

export class SeasonStartedError extends Error {
	name = "SeasonStartedError"

	constructor() {
		super("The game has started.")
	}
}

async function writeSeasonTree(
	seasonId: string,
	now: Date,
	filter: Filter<Season>,
	update: UpdateFilter<Season>,
	arrayFilters: Filter<unknown>[] = [],
): Promise<void> {
	const { seasons } = await collections()
	const target = { ...filter, _id: seasonId }
	const result = await seasons.updateOne({ ...target, $or: [{ start: null }, { start: { $gt: now } }] }, update, {
		arrayFilters,
	})
	if (result.matchedCount === 0) {
		if (!(await seasons.findOne(target))) throw new NotFoundError(`Season ${seasonId} has no ${JSON.stringify(filter)}`)
		throw new SeasonStartedError()
	}
}

export async function addArc(seasonId: string, now: Date): Promise<string> {
	const season = await getSeason(seasonId)
	if (!season) throw new NotFoundError(`Season ${seasonId} not found`)
	const arc = newArc(season.shuffleArcs)
	await writeSeasonTree(seasonId, now, {}, { $push: { arcs: arc } })
	return arc.id
}

export async function addQuest(seasonId: string, arcId: string, now: Date): Promise<string> {
	const quest = newQuest()
	const { path, filter, arrayFilters } = locate({ arcId, field: "quests" })
	await writeSeasonTree(seasonId, now, filter, { $push: { [path]: quest } }, arrayFilters)
	return quest.id
}

export async function removeArc(seasonId: string, arcId: string, now: Date): Promise<void> {
	await writeSeasonTree(seasonId, now, { "arcs.id": arcId }, { $pull: { arcs: { id: arcId } } })
}

export async function removeQuest(seasonId: string, arcId: string, questId: string, now: Date): Promise<void> {
	const { path, arrayFilters } = locate({ arcId, field: "quests" })
	const filter = { arcs: { $elemMatch: { id: arcId, "quests.id": questId } } }
	await writeSeasonTree(seasonId, now, filter, { $pull: { [path]: { id: questId } } }, arrayFilters)
}

const SeasonWindow = Season.pick({ start: true, end: true })
type SeasonWindow = z.infer<typeof SeasonWindow>

export class StaleWindowError extends Error {
	name = "StaleWindowError"
}

export class SeasonOverlapError extends Error {
	name = "SeasonOverlapError"

	constructor(public readonly season: Season) {
		super(`Overlaps "${season.title}", ${season.start?.toISOString()}–${season.end?.toISOString() ?? "no end"}.`)
	}
}

function checkSeasonWindow(seasons: Season[], season: Season, next: SeasonWindow, now: Date): void {
	const blocker = overlappingSeason(seasons, season._id, next)
	if (blocker) throw new SeasonOverlapError(blocker)
	if (season.registrationOpen && !hasEnded(next, now)) {
		refuseOtherOpen(
			seasons.map((s) => (s._id === season._id ? { ...s, ...next } : s)),
			season._id,
			now,
		)
	}
}

export async function setSeasonWindow(
	seasonId: string,
	expected: SeasonWindow & Partial<Pick<Season, "lengthMinutes">>,
	next: SeasonWindow,
	now: Date,
): Promise<void> {
	const current = SeasonWindow.extend({ lengthMinutes: Season.shape.lengthMinutes.optional() }).parse(expected)
	const parsed = SeasonWindow.parse(next)
	const seasons = await listSeasons()
	const season = seasons.find((s) => s._id === seasonId)
	if (!season) throw new NotFoundError(`Season ${seasonId} not found`)
	if (
		season.start?.getTime() !== current.start?.getTime() ||
		season.end?.getTime() !== current.end?.getTime() ||
		(current.lengthMinutes !== undefined && season.lengthMinutes !== current.lengthMinutes)
	) {
		throw new StaleWindowError(`Season ${seasonId} window changed`)
	}
	checkSeasonWindow(seasons, season, parsed, now)
	const result = await (await collections()).seasons.updateOne({ _id: seasonId, ...current }, { $set: parsed })
	if (result.matchedCount === 0) throw new StaleWindowError(`Season ${seasonId} window changed`)
}

export async function setSeasonLength(seasonId: string, minutes: number, now: Date): Promise<void> {
	const lengthMinutes = Season.shape.lengthMinutes.parse(minutes)
	const seasons = await listSeasons()
	const season = seasons.find((s) => s._id === seasonId)
	if (!season) throw new NotFoundError(`Season ${seasonId} not found`)
	const status = seasonStatus(season, now)
	if (status === "live" || status === "ended") throw new Error("Set at start. Use −5 / +5 min while live.")
	const next = scheduleWindow(season.start, lengthMinutes)
	if (season.start) checkSeasonWindow(seasons, season, next, now)
	const result = await (await collections()).seasons.updateOne(
		{ _id: seasonId, start: season.start, end: season.end, lengthMinutes: season.lengthMinutes },
		{ $set: season.start ? { lengthMinutes, ...next } : { lengthMinutes } },
	)
	if (result.matchedCount === 0) throw new StaleWindowError(`Season ${seasonId} window changed`)
}

function locate(target: SeasonFieldTarget): {
	path: string
	schema: z.ZodType
	filter: Filter<Season>
	arrayFilters: Filter<unknown>[]
} {
	if ("hintId" in target) {
		return {
			path: `arcs.$[a].quests.$[q].hints.$[h].${target.field}`,
			schema: Hint.shape[target.field],
			filter: {
				arcs: {
					$elemMatch: { id: target.arcId, quests: { $elemMatch: { id: target.questId, "hints.id": target.hintId } } },
				},
			},
			arrayFilters: [{ "a.id": target.arcId }, { "q.id": target.questId }, { "h.id": target.hintId }],
		}
	}
	if ("questId" in target) {
		return {
			path: `arcs.$[a].quests.$[q].${target.field}`,
			schema: target.field === "hints" ? Hints : Quest.shape[target.field],
			filter: { arcs: { $elemMatch: { id: target.arcId, "quests.id": target.questId } } },
			arrayFilters: [{ "a.id": target.arcId }, { "q.id": target.questId }],
		}
	}
	if ("arcId" in target) {
		return {
			path: `arcs.$[a].${target.field}`,
			schema: Arc.shape[target.field],
			filter: { "arcs.id": target.arcId },
			arrayFilters: [{ "a.id": target.arcId }],
		}
	}
	return { path: target.field, schema: Season.shape[target.field], filter: {}, arrayFilters: [] }
}

export async function setSeasonField(seasonId: string, target: SeasonFieldTarget, value: unknown): Promise<void> {
	if (target.field === "registrationOpen") {
		throw new Error("Use setRegistrationOpen to change registrationOpen")
	}
	const { path, schema, filter, arrayFilters } = locate(target)
	const parsed = schema.parse(value)
	if (target.field === "end") {
		const seasons = await listSeasons()
		const season = seasons.find((s) => s._id === seasonId)
		if (season?.registrationOpen) {
			const edited = seasons.map((s) => (s === season ? { ...s, end: parsed as Season["end"] } : s))
			refuseOtherOpen(edited, seasonId, new Date())
		}
	}
	const result = await (await collections()).seasons.updateOne(
		{ ...filter, _id: seasonId },
		{ $set: { [path]: parsed } },
		{ arrayFilters },
	)
	if (result.matchedCount === 0) throw new NotFoundError(`Season ${seasonId} has no ${JSON.stringify(target)}`)
}

const AnswerPatch = z.object({
	op: z.enum(["add", "remove"]),
	value: z
		.string()
		.transform((value) => value.trim().normalize("NFC"))
		.pipe(z.string().min(1).max(200)),
})
const HintPatch = z.discriminatedUnion("op", [
	z.object({ op: z.literal("add"), hint: HintInput }),
	z.object({ op: z.literal("remove"), hintId: Hint.shape.id }),
])

export async function patchSeasonList(
	seasonId: string,
	target: { arcId: string; questId: string; field: "answers" | "hints" },
	op: z.infer<typeof AnswerPatch> | z.infer<typeof HintPatch>,
): Promise<string | undefined> {
	const { path, filter, arrayFilters } = locate(target)
	let update: UpdateFilter<Season>
	let hintId: string | undefined
	if (target.field === "answers") {
		const parsed = AnswerPatch.parse(op)
		if (parsed.op === "add") {
			const season = await getSeason(seasonId)
			const quest = season?.arcs
				.find((arc) => arc.id === target.arcId)
				?.quests.find((quest) => quest.id === target.questId)
			if (!quest) throw new NotFoundError(`Season ${seasonId} has no ${JSON.stringify(target)}`)
			if (quest.answers.some((answer) => normalizeAnswer(answer) === normalizeAnswer(parsed.value))) return
			update = { $addToSet: { [path]: parsed.value } }
		} else {
			update = { $pull: { [path]: "value" in op ? op.value : parsed.value } }
		}
	} else {
		const parsed = HintPatch.parse(op)
		if (parsed.op === "add") {
			const hint = Hint.parse({ ...parsed.hint, id: parsed.hint.id ?? crypto.randomUUID() })
			hintId = hint.id
			arrayFilters[1] = { "q.id": target.questId, "q.hints.id": { $ne: hint.id } }
			update = { $push: { [path]: hint } }
		} else {
			update = { $pull: { [path]: { id: parsed.hintId } } }
		}
	}
	const result = await (await collections()).seasons.updateOne({ ...filter, _id: seasonId }, update, { arrayFilters })
	if (result.matchedCount === 0) throw new NotFoundError(`Season ${seasonId} has no ${JSON.stringify(target)}`)
	return hintId
}

export class RegistrationConflictError extends Error {
	name = "RegistrationConflictError"
}

function refuseOtherOpen(seasons: Season[], seasonId: string, now: Date): Season | null {
	const blocker = registrationConflict(seasons, seasonId, now)
	if (blocker && blocker._id !== seasonId) {
		throw new RegistrationConflictError(`Registration is already open for "${blocker.title}"`)
	}
	return blocker
}

export async function setRegistrationOpen(seasonId: string, open: boolean, now = new Date()): Promise<void> {
	if (open) {
		const seasons = await listSeasons()
		if (!seasons.some((s) => s._id === seasonId)) throw new NotFoundError(`Season ${seasonId} not found`)
		const ended = refuseOtherOpen(seasons, seasonId, now)
		if (ended) throw new RegistrationConflictError(`Season "${ended.title}" has ended`)
	}
	const result = await (await collections()).seasons.updateOne({ _id: seasonId }, { $set: { registrationOpen: open } })
	if (result.matchedCount === 0) throw new NotFoundError(`Season ${seasonId} not found`)
}
