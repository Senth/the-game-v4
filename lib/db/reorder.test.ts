import { Collection } from "mongodb"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Season } from "@/lib/domain/schemas"
import { newArc, newQuest } from "@/lib/domain/season-tree"
import { revealHint, submitAnswer } from "@/lib/game/game"
import { useTestDb } from "@/test/db"
import {
	createSeason,
	getSeason,
	MoveConflictError,
	moveArc,
	moveHint,
	moveQuest,
	patchSeasonList,
	removeArc,
	removeQuest,
	SeasonStartedError,
	setSeasonField,
} from "./seasons"
import { createTeam, getTeam } from "./teams"

useTestDb()
afterEach(() => vi.restoreAllMocks())
const now = new Date("2026-10-24T16:00:00Z")

async function setup(start: Date | null = null) {
	return createSeason({
		title: "Cipher Night",
		lengthMinutes: 60,
		start,
		end: start ? new Date(start.getTime() + 3_600_000) : null,
		shuffleArcs: false,
		arcs: [
			{
				...newArc(false),
				id: "a1",
				quests: [
					{
						...newQuest(),
						id: "q1",
						points: 50,
						answers: ["lamp"],
						hints: [
							{ id: "h1", text: "First", points: 5 },
							{ id: "h2", text: "Second", points: 10 },
							{ id: "h3", text: "Third", points: 15 },
						],
					},
					{ ...newQuest(), id: "q2" },
					{ ...newQuest(), id: "q3" },
				],
			},
			{ ...newArc(true), id: "a2", quests: [{ ...newQuest(), id: "q4" }] },
			{ ...newArc(false), id: "a3" },
		],
	})
}

function order(season: Season | null) {
	return season?.arcs.map((arc) => [arc.id, arc.quests.map((quest) => quest.id)])
}

const moves = [
	{ kind: "hint", id: "h1", beforeId: "h3", run: moveHint },
	{ kind: "quest", id: "q1", beforeId: "q3", run: (target: Parameters<typeof moveQuest>[0]) => moveQuest(target, now) },
	{ kind: "arc", id: "a1", beforeId: "a3", run: (target: Parameters<typeof moveArc>[0]) => moveArc(target, now) },
] as const

describe("atomic reorder writes", () => {
	it.each(moves)(
		"moves $kind before an id, to the end, to the front and onto itself",
		async ({ kind, id, beforeId, run }) => {
			const season = await setup()
			const target = { seasonId: season._id, id, toArcId: "a1", beforeId }
			const ids = async () => {
				const stored = await getSeason(season._id)
				if (kind === "hint") return stored?.arcs[0]?.quests[0]?.hints.map((hint) => hint.id)
				if (kind === "quest") return stored?.arcs[0]?.quests.map((quest) => quest.id)
				return stored?.arcs.map((arc) => arc.id)
			}
			const original = await ids()
			if (!original) throw new Error("fixture")
			await run(target)
			expect(await ids()).toEqual([original[1], original[0], original[2]])
			await run({ ...target, beforeId: null })
			expect(await ids()).toEqual([original[1], original[2], original[0]])
			await run({ ...target, beforeId: original[1] as string })
			expect(await ids()).toEqual(original)
			await run({ ...target, beforeId: id })
			expect(await getSeason(season._id)).toEqual(season)
		},
	)

	it.each(["a2", "a3"])("moves a quest across arcs into %s without changing its fields", async (toArcId) => {
		const season = await setup()
		await moveQuest({ seasonId: season._id, id: "q1", toArcId, beforeId: toArcId === "a2" ? "q4" : null }, now)
		const stored = await getSeason(season._id)
		expect(order(stored)).toEqual([
			["a1", ["q2", "q3"]],
			["a2", toArcId === "a2" ? ["q1", "q4"] : ["q4"]],
			["a3", toArcId === "a3" ? ["q1"] : []],
		])
		expect(stored?.arcs.find((arc) => arc.id === toArcId)?.quests[0]).toEqual(season.arcs[0]?.quests[0])
	})

	it.each(moves)(
		"$kind uses one pipeline write and preserves edits made after the client read",
		async ({ id, beforeId, run }) => {
			const season = await setup()
			const originalUpdate = Collection.prototype.updateOne
			const write = vi.spyOn(Collection.prototype, "updateOne").mockImplementationOnce(async function (
				this: Collection,
				...args
			) {
				await setSeasonField(season._id, { arcId: "a1", questId: "q1", hintId: "h1", field: "text" }, "Edited")
				await setSeasonField(season._id, { arcId: "a1", questId: "q1", field: "points" }, 100)
				await patchSeasonList(
					season._id,
					{ arcId: "a1", questId: "q1", field: "answers" },
					{ op: "add", value: "beacon" },
				)
				await setSeasonField(season._id, { arcId: "a1", field: "shuffleQuests" }, true)
				await setSeasonField(season._id, { field: "shuffleArcs" }, true)
				return originalUpdate.apply(this, args)
			})
			await run({ seasonId: season._id, id, toArcId: "a2", beforeId: id === "q1" ? "q4" : beforeId })
			expect(write.mock.calls.filter(([, update]) => Array.isArray(update))).toHaveLength(1)
			const stored = await getSeason(season._id)
			expect(stored?.shuffleArcs).toBe(true)
			expect(stored?.arcs.find((arc) => arc.id === "a1")?.shuffleQuests).toBe(true)
			expect(stored?.arcs.flatMap((arc) => arc.quests).find((quest) => quest.id === "q1")).toMatchObject({
				points: 100,
				answers: ["lamp", "beacon"],
				hints: expect.arrayContaining([{ id: "h1", text: "Edited", points: 5 }]),
			})
		},
	)

	it.each(moves)(
		"$kind rejects missing moved ids, anchors and seasons without writing",
		async ({ id, beforeId, run }) => {
			const season = await setup()
			for (const target of [
				{ seasonId: "missing", id, toArcId: "a1", beforeId },
				{ seasonId: season._id, id: "missing", toArcId: "a1", beforeId },
				{ seasonId: season._id, id, toArcId: "a1", beforeId: "missing" },
			])
				await expect(run(target)).rejects.toBeInstanceOf(MoveConflictError)
			expect(await getSeason(season._id)).toEqual(season)
		},
	)

	it("rejects anchors in another quest or arc and missing destination arcs", async () => {
		const season = await setup()
		await patchSeasonList(
			season._id,
			{ arcId: "a1", questId: "q2", field: "hints" },
			{ op: "add", hint: { id: "other", text: "Other", points: 1 } },
		)
		const before = await getSeason(season._id)
		await expect(moveHint({ seasonId: season._id, id: "h1", beforeId: "other" })).rejects.toBeInstanceOf(
			MoveConflictError,
		)
		await expect(
			moveQuest({ seasonId: season._id, id: "q1", toArcId: "a2", beforeId: "q2" }, now),
		).rejects.toBeInstanceOf(MoveConflictError)
		await expect(
			moveQuest({ seasonId: season._id, id: "q1", toArcId: "missing", beforeId: null }, now),
		).rejects.toBeInstanceOf(MoveConflictError)
		expect(await getSeason(season._id)).toEqual(before)
	})

	it.each(["hint", "quest", "arc", "anchor", "destination"])(
		"conflicts when a concurrent request removes the %s before the write",
		async (kind) => {
			const season = await setup()
			const originalUpdate = Collection.prototype.updateOne
			vi.spyOn(Collection.prototype, "updateOne").mockImplementationOnce(async function (this: Collection, ...args) {
				if (kind === "hint" || kind === "anchor")
					await patchSeasonList(
						season._id,
						{ arcId: "a1", questId: "q1", field: "hints" },
						{ op: "remove", hintId: kind === "hint" ? "h1" : "h2" },
					)
				else if (kind === "quest") await removeQuest(season._id, "a1", "q1", now)
				else await removeArc(season._id, kind === "arc" ? "a1" : "a2", now)
				return originalUpdate.apply(this, args)
			})
			const operation =
				kind === "hint" || kind === "anchor"
					? moveHint({ seasonId: season._id, id: "h1", beforeId: "h2" })
					: kind === "arc"
						? moveArc({ seasonId: season._id, id: "a1", beforeId: "a3" }, now)
						: moveQuest({ seasonId: season._id, id: "q1", toArcId: "a2", beforeId: null }, now)
			await expect(operation).rejects.toBeInstanceOf(MoveConflictError)
			const stored = await getSeason(season._id)
			if (kind === "hint" || kind === "anchor")
				expect(stored?.arcs[0]?.quests[0]?.hints.map((hint) => hint.id)).toEqual(
					kind === "hint" ? ["h2", "h3"] : ["h1", "h3"],
				)
			else
				expect(order(stored)).toEqual(
					kind === "quest"
						? [
								["a1", ["q2", "q3"]],
								["a2", ["q4"]],
								["a3", []],
							]
						: kind === "arc"
							? [
									["a2", ["q4"]],
									["a3", []],
								]
							: [
									["a1", ["q1", "q2", "q3"]],
									["a3", []],
								],
				)
		},
	)

	it.each([now, new Date(now.getTime() - 3_600_000)])(
		"blocks structural moves at or after start %j but allows hints",
		async (start) => {
			const season = await setup(start)
			await expect(moveArc({ seasonId: season._id, id: "a1", beforeId: null }, now)).rejects.toBeInstanceOf(
				SeasonStartedError,
			)
			await expect(
				moveQuest({ seasonId: season._id, id: "q1", toArcId: "a2", beforeId: null }, now),
			).rejects.toBeInstanceOf(SeasonStartedError)
			expect(await getSeason(season._id)).toEqual(season)
			await moveHint({ seasonId: season._id, id: "h1", beforeId: null })
			expect((await getSeason(season._id))?.arcs[0]?.quests[0]?.hints.map((hint) => hint.id)).toEqual([
				"h2",
				"h3",
				"h1",
			])
		},
	)

	it.each(["arc", "quest"])("checks the live guard inside the %s write after a concurrent start", async (kind) => {
		const season = await setup()
		const originalUpdate = Collection.prototype.updateOne
		vi.spyOn(Collection.prototype, "updateOne").mockImplementationOnce(async function (this: Collection, ...args) {
			await setSeasonField(season._id, { field: "start" }, now)
			return originalUpdate.apply(this, args)
		})
		await expect(
			kind === "arc"
				? moveArc({ seasonId: season._id, id: "a1", beforeId: null }, now)
				: moveQuest({ seasonId: season._id, id: "q1", toArcId: "a2", beforeId: null }, now),
		).rejects.toBeInstanceOf(SeasonStartedError)
		expect(await getSeason(season._id)).toEqual({ ...season, start: now })
	})

	it("keeps both concurrent cross-arc moves into the same empty arc", async () => {
		const season = await setup()
		await Promise.all(
			["q1", "q4"].map((id) => moveQuest({ seasonId: season._id, id, toArcId: "a3", beforeId: null }, now)),
		)
		const stored = await getSeason(season._id)
		expect(stored?.arcs[0]?.quests.map((quest) => quest.id)).toEqual(["q2", "q3"])
		expect(stored?.arcs[1]?.quests).toEqual([])
		expect(stored?.arcs[2]?.quests.map((quest) => quest.id).toSorted()).toEqual(["q1", "q4"])
	})

	it("treats dollar-prefixed ids as literal values, never aggregation expressions", async () => {
		const season = await setup()
		await setSeasonField(season._id, { arcId: "a1", questId: "q1", field: "hints" }, [
			{ id: "$first", text: "First", points: 5 },
			{ id: "$$second", text: "Second", points: 10 },
		])
		await moveHint({ seasonId: season._id, id: "$$second", beforeId: "$first" })
		expect((await getSeason(season._id))?.arcs[0]?.quests[0]?.hints.map((hint) => hint.id)).toEqual([
			"$$second",
			"$first",
		])
	})

	it("keeps revealed hint snapshots and charges original points after reorder and edits", async () => {
		const season = await setup(now)
		const team = await createTeam({
			name: "Ninjas",
			passwordHash: "hash",
			seasonId: season._id,
			questOrder: ["q1"],
			questIndex: 0,
			score: 0,
			completed: false,
			progress: [],
		})
		expect(await revealHint(team, "h1", now)).toMatchObject({ ok: true })
		await moveHint({ seasonId: season._id, id: "h1", beforeId: null })
		await setSeasonField(season._id, { arcId: "a1", questId: "q1", hintId: "h1", field: "text" }, "Changed")
		await setSeasonField(season._id, { arcId: "a1", questId: "q1", hintId: "h1", field: "points" }, 40)
		expect(await submitAnswer(team, "q1", "lamp", new Date(now.getTime() + 1000))).toMatchObject({
			ok: true,
			correct: true,
			pointsEarned: 45,
		})
		expect(await getTeam(team._id)).toMatchObject({
			score: 45,
			completed: true,
			progress: [
				{
					questId: "q1",
					pointsEarned: 45,
					hintsRevealed: [{ hintId: "h1", text: "First", points: 5, revealedAt: now }],
				},
			],
		})
	})
})
