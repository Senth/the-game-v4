import type { Document, Filter, UpdateFilter } from "mongodb"
import { z } from "zod"
import { overlappingSeason, scheduleWindow, seasonStatus } from "@/lib/domain/admin-seasons"
import { hasEnded, normalizeAnswer, registrationConflict } from "@/lib/domain/game"
import { missingForGame } from "@/lib/domain/playable-quests"
import {
	AnswerAddValue,
	Arc,
	Hint,
	HintInput,
	Quest,
	Season,
	type SeasonInput,
	withHintIds,
} from "@/lib/domain/schemas"
import { newArc, newQuest } from "@/lib/domain/season-tree"
import { boardChannel, publish, seasonChannel } from "@/lib/events/bus"
import { getDbWithoutIndexes } from "./client"
import { collections, NotFoundError } from "./collections"
import { finishSeasonStructure, type PendingStructure, withSeasonStructure } from "./structural-writes"

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

export async function getSeasonForImport(id: string): Promise<Season | null> {
	return getDbWithoutIndexes().then((db) => db.collection<Season>("seasons").findOne({ _id: id }))
}

export async function listSeasons(): Promise<Season[]> {
	return (await collections()).seasons.find().toArray()
}

export class CopyTargetStartedError extends Error {
	name = "CopyTargetStartedError"

	constructor(title: string) {
		super(`${title} has started. Pick another season.`)
	}
}

async function writeCopy(seasonId: string, filter: Filter<Season>, update: UpdateFilter<Season>): Promise<void> {
	const { seasons } = await collections()
	const result = await seasons.updateOne(
		{ ...filter, _id: seasonId, $or: [{ start: null }, { $expr: { $gt: ["$start", "$$NOW"] } }] },
		update,
	)
	if (result.matchedCount === 0) {
		const season = await seasons.findOne({ _id: seasonId })
		if (!season) throw new NotFoundError(`Season ${seasonId} not found`)
		if (season.start && season.start <= new Date()) throw new CopyTargetStartedError(season.title)
		throw new NotFoundError(`Arc ${filter["arcs.id"]} not found`)
	}
}

export async function copyArcToSeason(seasonId: string, arc: Arc): Promise<void> {
	await writeCopy(seasonId, {}, { $push: { arcs: Arc.parse(arc) } })
}

export async function copyQuestToSeason(
	seasonId: string,
	target: { arcId: string } | { newArc: Pick<Arc, "title" | "shuffleQuests"> },
	quest: Quest,
): Promise<string> {
	const parsed = Quest.parse(quest)
	if ("newArc" in target) {
		const arc = { ...newArc(target.newArc.shuffleQuests), ...target.newArc, quests: [parsed] }
		await copyArcToSeason(seasonId, arc)
		return arc.id
	}
	await writeCopy(seasonId, { "arcs.id": target.arcId }, { $push: { "arcs.$.quests": parsed } })
	return target.arcId
}

export class SeasonStartedError extends Error {
	name = "SeasonStartedError"

	constructor() {
		super("The game has started.")
	}
}

export class SeasonEndedError extends Error {
	name = "SeasonEndedError"
	constructor() {
		super("The game has ended.")
	}
}

export class QuestNotReadyError extends Error {
	name = "QuestNotReadyError"
	constructor(fields: string[]) {
		super(`Fill in ${new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" }).format(fields)} first.`)
	}
}

async function writeSeasonTree(
	seasonId: string,
	now: Date,
	filter: Filter<Season>,
	update: UpdateFilter<Season>,
	arrayFilters: Filter<unknown>[] = [],
	state: "editable" | "beforeStart" | "live" = "editable",
): Promise<Season> {
	const { seasons } = await collections()
	const target = { ...filter, _id: seasonId }
	const before = await seasons.findOneAndUpdate(
		{
			...target,
			$and: [
				{ $or: [{ start: null }, { start: { $gt: now } }, { end: null }, { end: { $gt: now } }] },
				...(state === "beforeStart" ? [{ $or: [{ start: null }, { start: { $gt: now } }] }] : []),
				...(state === "live" ? [{ start: { $ne: null, $lte: now } }] : []),
			],
		},
		update,
		{
			arrayFilters,
			returnDocument: "before",
		},
	)
	if (!before) {
		const season = await seasons.findOne({ _id: seasonId })
		if (season && seasonStatus(season, now) === "ended") throw new SeasonEndedError()
		if (!(await seasons.findOne(target))) throw new NotFoundError(`Season ${seasonId} has no ${JSON.stringify(filter)}`)
		throw new SeasonStartedError()
	}
	return before
}

export async function addArc(seasonId: string, now: Date): Promise<string> {
	return withSeasonStructure(seasonId, async () => {
		await finishSeasonStructure(seasonId)
		const season = await getSeason(seasonId)
		if (!season) throw new NotFoundError(`Season ${seasonId} not found`)
		const arc = newArc(season.shuffleArcs)
		await writeSeasonTree(seasonId, now, {}, { $push: { arcs: arc } })
		return arc.id
	})
}

export async function addQuest(seasonId: string, arcId: string, now: Date): Promise<string> {
	return withSeasonStructure(seasonId, async () => {
		await finishSeasonStructure(seasonId)
		const season = await getSeason(seasonId)
		if (!season) throw new NotFoundError(`Season ${seasonId} not found`)
		const live = seasonStatus(season, now) === "live"
		const quest = { ...newQuest(), ...(live ? { hidden: true } : {}) }
		const { path, filter, arrayFilters } = locate({ arcId, field: "quests" })
		await writeSeasonTree(
			seasonId,
			now,
			filter,
			{ $push: { [path]: quest } },
			arrayFilters,
			live ? "live" : "beforeStart",
		)
		return quest.id
	})
}

export async function addQuestToGame(seasonId: string, arcId: string, questId: string, now: Date): Promise<string[]> {
	return withSeasonStructure(seasonId, async () => {
		const target = JSON.stringify(["addQuestToGame", arcId, questId])
		const resumed = await finishSeasonStructure(seasonId)
		if (resumed?.target === target) return resumed.affected
		const season = await getSeason(seasonId)
		if (season && seasonStatus(season, now) === "ended") throw new SeasonEndedError()
		const quest = season?.arcs.find((arc) => arc.id === arcId)?.quests.find((quest) => quest.id === questId)
		if (!quest) throw new NotFoundError(`Quest ${questId} not found`)
		if (!quest.hidden) {
			publish(seasonChannel(seasonId))
			publish(boardChannel)
			return []
		}
		const missing = missingForGame(quest)
		if (missing.length) throw new QuestNotReadyError(missing)
		const { path, arrayFilters } = locate({ arcId, questId, field: "hidden" })
		const pendingStructure: PendingStructure = { target, edit: { kind: "addQuest", questId }, assetPaths: [] }
		await writeSeasonTree(
			seasonId,
			now,
			{ arcs: { $elemMatch: { id: arcId, quests: { $elemMatch: quest } } } },
			{ $set: { [path]: false, pendingStructure } },
			arrayFilters,
			"live",
		)
		return (await finishSeasonStructure(seasonId))?.affected ?? []
	})
}

type RemovalResult = { assetPaths: string[]; affected: string[] }

export async function removeArc(seasonId: string, arcId: string, now: Date): Promise<RemovalResult> {
	return withSeasonStructure(seasonId, async () => {
		const target = JSON.stringify(["removeArc", arcId])
		const resumed = await finishSeasonStructure(seasonId)
		if (resumed?.target === target) return { assetPaths: resumed.assetPaths, affected: resumed.affected }
		const season = await getSeason(seasonId)
		const arc = season?.arcs.find((arc) => arc.id === arcId)
		if (!season || !arc) throw new NotFoundError(`Arc ${arcId} not found`)
		const pendingStructure: PendingStructure = {
			target,
			edit:
				seasonStatus(season, now) === "live"
					? {
							kind: "deleteQuest",
							questIds: arc.quests.filter((quest) => !quest.hidden).map((quest) => quest.id),
						}
					: null,
			assetPaths: arc.quests.flatMap((quest) => (quest.assetPath === null ? [] : [quest.assetPath])),
		}
		await writeSeasonTree(
			seasonId,
			now,
			{ start: season.start, end: season.end, arcs: { $elemMatch: arc } },
			{
				$pull: { arcs: { id: arcId } },
				$set: { pendingStructure },
			},
		)
		return {
			assetPaths: pendingStructure.assetPaths,
			affected: (await finishSeasonStructure(seasonId))?.affected ?? [],
		}
	})
}

export async function removeQuest(seasonId: string, arcId: string, questId: string, now: Date): Promise<RemovalResult> {
	return withSeasonStructure(seasonId, async () => {
		const target = JSON.stringify(["removeQuest", arcId, questId])
		const resumed = await finishSeasonStructure(seasonId)
		if (resumed?.target === target) return { assetPaths: resumed.assetPaths, affected: resumed.affected }
		const season = await getSeason(seasonId)
		const quest = season?.arcs.find((arc) => arc.id === arcId)?.quests.find((quest) => quest.id === questId)
		if (!season || !quest) throw new NotFoundError(`Quest ${questId} not found`)
		const pendingStructure: PendingStructure = {
			target,
			edit: seasonStatus(season, now) === "live" && !quest.hidden ? { kind: "deleteQuest", questIds: [questId] } : null,
			assetPaths: quest.assetPath === null ? [] : [quest.assetPath],
		}
		const { path, arrayFilters } = locate({ arcId, field: "quests" })
		const filter = {
			start: season.start,
			end: season.end,
			arcs: { $elemMatch: { id: arcId, quests: { $elemMatch: quest } } },
		}
		await writeSeasonTree(
			seasonId,
			now,
			filter,
			{
				$pull: { [path]: { id: questId } },
				$set: { pendingStructure },
			},
			arrayFilters,
		)
		return {
			assetPaths: pendingStructure.assetPaths,
			affected: (await finishSeasonStructure(seasonId))?.affected ?? [],
		}
	})
}

export type MoveTarget = { seasonId: string; id: string; beforeId: string | null }

export class MoveConflictError extends Error {
	name = "MoveConflictError"

	constructor() {
		super("Not saved, retry")
	}
}

function moveItems(input: string, source: string | Document, id: string, beforeId: string | null): Document | string {
	if (beforeId === id) return input
	const remaining = { $filter: { input, as: "item", cond: { $ne: ["$$item.id", { $literal: id }] } } }
	return {
		$let: {
			vars: {
				moved: { $first: { $filter: { input: source, as: "item", cond: { $eq: ["$$item.id", { $literal: id }] } } } },
			},
			in:
				beforeId === null
					? { $concatArrays: [remaining, ["$$moved"]] }
					: {
							$reduce: {
								input: remaining,
								initialValue: [],
								in: {
									$concatArrays: [
										"$$value",
										{ $cond: [{ $eq: ["$$this.id", { $literal: beforeId }] }, ["$$moved", "$$this"], ["$$this"]] },
									],
								},
							},
						},
		},
	}
}

async function writeMove(
	seasonId: string,
	filter: Filter<Season>,
	arcs: Document | string,
	now: Date | null,
): Promise<void> {
	const { seasons } = await collections()
	const target = { ...filter, _id: seasonId }
	const result = await seasons.updateOne(
		{ ...target, ...(now ? { $or: [{ start: null }, { start: { $gt: now } }] } : {}) },
		[{ $set: { arcs } }],
	)
	if (result.matchedCount === 0) {
		const season = now && (await seasons.findOne(target))
		if (season && now && seasonStatus(season, now) === "ended") throw new SeasonEndedError()
		if (season) throw new SeasonStartedError()
		throw new MoveConflictError()
	}
}

export async function moveArc({ seasonId, id, beforeId }: MoveTarget, now: Date): Promise<void> {
	await writeMove(
		seasonId,
		{ "arcs.id": id, ...(beforeId === null ? {} : { arcs: { $elemMatch: { id: beforeId } } }) },
		moveItems("$arcs", "$arcs", id, beforeId),
		now,
	)
}

export async function moveQuest(
	{ seasonId, id, toArcId, beforeId }: MoveTarget & { toArcId: string },
	now: Date,
): Promise<void> {
	const quests = { $reduce: { input: "$arcs", initialValue: [], in: { $concatArrays: ["$$value", "$$this.quests"] } } }
	await writeMove(
		seasonId,
		{
			"arcs.quests.id": id,
			arcs: { $elemMatch: { id: toArcId, ...(beforeId === null ? {} : { "quests.id": beforeId }) } },
		},
		{
			$map: {
				input: "$arcs",
				as: "arc",
				in: {
					$mergeObjects: [
						"$$arc",
						{
							quests: {
								$cond: [
									{ $eq: ["$$arc.id", { $literal: toArcId }] },
									moveItems("$$arc.quests", quests, id, beforeId),
									{ $filter: { input: "$$arc.quests", as: "quest", cond: { $ne: ["$$quest.id", { $literal: id }] } } },
								],
							},
						},
					],
				},
			},
		},
		now,
	)
}

export async function moveHint({ seasonId, id, beforeId }: MoveTarget): Promise<void> {
	await writeMove(
		seasonId,
		{
			arcs: {
				$elemMatch: {
					quests: {
						$elemMatch: { "hints.id": id, ...(beforeId === null ? {} : { hints: { $elemMatch: { id: beforeId } } }) },
					},
				},
			},
		},
		{
			$map: {
				input: "$arcs",
				as: "arc",
				in: {
					$mergeObjects: [
						"$$arc",
						{
							quests: {
								$map: {
									input: "$$arc.quests",
									as: "quest",
									in: {
										$cond: [
											{ $in: [{ $literal: id }, "$$quest.hints.id"] },
											{
												$mergeObjects: [
													"$$quest",
													{ hints: moveItems("$$quest.hints", "$$quest.hints", id, beforeId) },
												],
											},
											"$$quest",
										],
									},
								},
							},
						},
					],
				},
			},
		},
		null,
	)
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

export async function setQuestAsset(
	seasonId: string,
	arcId: string,
	questId: string,
	assetPath: string | null,
): Promise<string | null> {
	const target = { arcId, questId, field: "assetPath" } as const
	const { path, schema, filter, arrayFilters } = locate(target)
	const parsed = schema.parse(assetPath)
	const before = await (await collections()).seasons.findOneAndUpdate(
		{ ...filter, _id: seasonId },
		{ $set: { [path]: parsed } },
		{ arrayFilters, returnDocument: "before" },
	)
	if (!before) throw new NotFoundError(`Season ${seasonId} has no ${JSON.stringify(target)}`)
	return before.arcs.find((arc) => arc.id === arcId)?.quests.find((quest) => quest.id === questId)?.assetPath ?? null
}

export async function isAssetReferenced(assetPath: string): Promise<boolean> {
	const contentReference = assetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	return (
		(await (
			await collections()
		).seasons.countDocuments(
			{
				$or: [{ "arcs.quests.assetPath": assetPath }, { "arcs.quests.content": { $regex: contentReference } }],
			},
			{ limit: 1 },
		)) > 0
	)
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

const AnswerPatch = z.discriminatedUnion("op", [
	z.object({ op: z.literal("add"), value: AnswerAddValue }),
	z.object({ op: z.literal("remove"), value: z.string() }),
])
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
			update = { $pull: { [path]: parsed.value } }
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
