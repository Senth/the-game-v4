import type { Filter } from "mongodb"
import { z } from "zod"
import { registrationConflict } from "@/lib/domain/game"
import { Arc, Hint, HintInput, Quest, Season, type SeasonInput, withHintIds } from "@/lib/domain/schemas"
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
