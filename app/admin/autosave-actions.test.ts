import { redirect } from "next/navigation"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { requireAdmin } from "@/lib/auth/guards"
import { collections } from "@/lib/db/collections"
import type { SeasonFieldTarget } from "@/lib/db/seasons"
import * as seasons from "@/lib/db/seasons"
import { boardChannel, publish, seasonChannel } from "@/lib/events/bus"
import { useTestDb } from "@/test/db"
import {
	addFinisherBonus,
	patchSeasonList,
	removeLastFinisherBonus,
	saveSeasonField,
	setFinisherBonus,
} from "./autosave-actions"

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/events/bus", async (original) => ({
	...(await original<typeof import("@/lib/events/bus")>()),
	publish: vi.fn(),
}))

useTestDb()

beforeEach(async () => {
	await (await collections()).seasons.deleteMany({})
	vi.restoreAllMocks()
	vi.mocked(requireAdmin).mockReset().mockResolvedValue({ _id: "admin", name: "admin", passwordHash: "hash" })
	vi.mocked(publish).mockClear()
})

async function setup() {
	return seasons.createSeason({
		title: "Cipher Night",
		lengthMinutes: 60,
		start: null,
		end: null,
		shuffleArcs: false,
		arcs: [
			{
				id: "a1",
				title: "Lighthouse",
				shuffleQuests: false,
				quests: [
					{
						id: "q1",
						displayTitle: "Beacon",
						internalTitle: "beacon",
						content: "Decode",
						assetPath: null,
						answers: ["lamp"],
						points: 50,
						adminNotes: "",
						hints: [{ id: "h1", text: "First", points: 5 }],
					},
				],
			},
		],
	})
}

const quest = { arcId: "a1", questId: "q1" }

describe("autosave actions", () => {
	it("adds, autosaves and removes bonus rows without replacing other settings", async () => {
		const season = await setup()
		expect(await addFinisherBonus(season._id, 50)).toEqual({ ok: true })
		expect(vi.mocked(publish).mock.calls).toEqual([[seasonChannel(season._id)], [boardChannel]])
		vi.mocked(publish).mockClear()
		expect(await saveSeasonField(season._id, { field: "finisherBonuses", index: "0" }, 20)).toEqual({ ok: true })
		expect((await seasons.getSeason(season._id))?.finisherBonuses).toEqual([20])
		expect(vi.mocked(publish).mock.calls).toEqual([[seasonChannel(season._id)], [boardChannel]])
		vi.mocked(publish).mockClear()
		expect(await removeLastFinisherBonus(season._id)).toEqual({ ok: true })
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(vi.mocked(publish).mock.calls).toEqual([[seasonChannel(season._id)], [boardChannel]])
	})

	it("locks claimed rows, including rows added after a finish, and preserves awarded points", async () => {
		const season = await setup()
		await (await collections()).seasons.updateOne(
			{ _id: season._id },
			{
				$set: {
					finishers: [{ teamId: "winner", place: 1, points: 0, at: new Date() }],
				},
			},
		)
		expect(await addFinisherBonus(season._id, 50)).toEqual({ ok: true })
		vi.mocked(publish).mockClear()
		const before = await seasons.getSeason(season._id)
		for (const result of [
			await setFinisherBonus(season._id, 0, 100),
			await saveSeasonField(season._id, { field: "finisherBonuses", index: "0" }, 100),
			await removeLastFinisherBonus(season._id),
		])
			expect(result).toEqual({ ok: false, error: "Already won, can't change" })
		expect(await seasons.getSeason(season._id)).toEqual(before)
		expect(publish).not.toHaveBeenCalled()
		expect(await addFinisherBonus(season._id, 20)).toEqual({ ok: true })
		expect(await setFinisherBonus(season._id, 1, 10)).toEqual({ ok: true })
		expect(await removeLastFinisherBonus(season._id)).toEqual({ ok: true })
		expect(await seasons.getSeason(season._id)).toEqual(before)
	})

	it.each(["add", "set", "remove"])("rejects unauthenticated bonus %s calls", async (action) => {
		const season = await setup()
		vi.mocked(requireAdmin).mockImplementationOnce(async () => redirect("/login"))
		await expect(
			action === "add"
				? addFinisherBonus(season._id, 50)
				: action === "set"
					? setFinisherBonus(season._id, 0, 20)
					: removeLastFinisherBonus(season._id),
		).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") })
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it.each([-1, 10001, 1.5, Number.NaN])("rejects invalid bonus points %s", async (points) => {
		const season = await setup()
		expect(await addFinisherBonus(season._id, points)).toEqual({ ok: false, error: "Invalid value." })
		expect(await setFinisherBonus(season._id, 0, points)).toEqual({ ok: false, error: "Invalid value." })
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it.each(["finisherBonuses", "finishers"] as const)("rejects whole %s autosaves", async (field) => {
		const season = await setup()
		expect(await saveSeasonField(season._id, { field }, [])).toEqual({ ok: false, error: "Invalid value." })
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})
	it.each([true, false])("rejects hidden autosave %s without writing or publishing", async (value) => {
		const season = await setup()
		await (await collections()).seasons.updateOne({ _id: season._id }, { $set: { "arcs.0.quests.0.hidden": !value } })
		const before = await seasons.getSeason(season._id)
		expect(await saveSeasonField(season._id, { ...quest, field: "hidden" }, value)).toEqual({
			ok: false,
			error: "Invalid value.",
		})
		expect(await seasons.getSeason(season._id)).toEqual(before)
		expect(publish).not.toHaveBeenCalled()
	})

	it("rejects assetPath autosave without writing or publishing", async () => {
		const season = await setup()
		expect(await saveSeasonField(season._id, { ...quest, field: "assetPath" }, "/assets/image.png")).toEqual({
			ok: false,
			error: "Invalid value.",
		})
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it.each([null, 0, 10000])("saves quest points %j", async (value) => {
		const season = await setup()
		expect(await saveSeasonField(season._id, { ...quest, field: "points" }, value)).toEqual({ ok: true })
		expect((await seasons.getSeason(season._id))?.arcs[0]?.quests[0]?.points).toBe(value)
	})

	it.each([-1, 10001, 2.5, Number.NaN])("rejects quest points %j with shared copy without writing", async (value) => {
		const season = await setup()
		expect(await saveSeasonField(season._id, { ...quest, field: "points" }, value)).toEqual({
			ok: false,
			error: "Use a whole number from 0 to 10000.",
		})
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it.each([0, 10000])("saves hint penalty %j", async (value) => {
		const season = await setup()
		expect(await saveSeasonField(season._id, { ...quest, hintId: "h1", field: "points" }, value)).toEqual({ ok: true })
		expect((await seasons.getSeason(season._id))?.arcs[0]?.quests[0]?.hints[0]?.points).toBe(value)
	})

	it.each([-3, 10001, 2.5])("rejects hint penalty %j with shared copy without writing", async (value) => {
		const season = await setup()
		expect(await saveSeasonField(season._id, { ...quest, hintId: "h1", field: "points" }, value)).toEqual({
			ok: false,
			error: "Use a whole number from 0 to 10000.",
		})
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it.each([-3, 10001, 2.5])("rejects invalid hint penalty add %j without writing or publishing", async (value) => {
		const season = await setup()
		expect(
			await patchSeasonList(
				season._id,
				{ ...quest, field: "hints" },
				{ op: "add", hint: { text: "Second", points: value } },
			),
		).toEqual({ ok: false })
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it.each(["", "   ", "x".repeat(201)])("rejects invalid answer %j without writing or publishing", async (value) => {
		const season = await setup()
		expect(await patchSeasonList(season._id, { ...quest, field: "answers" }, { op: "add", value })).toEqual({
			ok: false,
		})
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it("returns ok for cleaned answer adds and normalized duplicates", async () => {
		const season = await setup()
		for (const value of [" Fyren ", "fyren", "å", "a\u030a", "x".repeat(200)]) {
			expect(await patchSeasonList(season._id, { ...quest, field: "answers" }, { op: "add", value })).toEqual({
				ok: true,
			})
		}
		expect((await seasons.getSeason(season._id))?.arcs[0]?.quests[0]?.answers).toEqual([
			"lamp",
			"Fyren",
			"å",
			"x".repeat(200),
		])
	})

	it.each([-1, 10001, 2.5, Number.NaN, "assetPath", "", "   ", "x".repeat(201)])(
		"rejects a team session before new validation for %j",
		async (value) => {
			const season = await setup()
			vi.mocked(requireAdmin).mockImplementationOnce(async () => redirect("/"))
			const action =
				typeof value === "number" || value === "assetPath"
					? saveSeasonField(season._id, { ...quest, field: value === "assetPath" ? "assetPath" : "points" }, value)
					: patchSeasonList(season._id, { ...quest, field: "answers" }, { op: "add", value })
			await expect(action).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") })
			expect(await seasons.getSeason(season._id)).toEqual(season)
			expect(publish).not.toHaveBeenCalled()
		},
	)

	it("rejects direct end saves without writing or publishing", async () => {
		const season = await setup()
		expect(await saveSeasonField(season._id, { field: "end" }, new Date())).toMatchObject({ ok: false })
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it("rejects scheduling in the past with shared copy", async () => {
		const season = await setup()
		expect(await saveSeasonField(season._id, { field: "start" }, new Date(Date.now() - 1000))).toEqual({
			ok: false,
			error: "Pick a time in the future.",
		})
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it("schedules start and end together", async () => {
		const season = await setup()
		const start = new Date(Date.now() + 60_000)
		expect(await saveSeasonField(season._id, { field: "start" }, start)).toEqual({ ok: true })
		expect(await seasons.getSeason(season._id)).toMatchObject({
			start,
			end: new Date(start.getTime() + 3_600_000),
		})
		expect(vi.mocked(publish).mock.calls).toEqual([[seasonChannel(season._id)], [boardChannel]])
	})

	it("allows scheduling without quests and clearing the upcoming window", async () => {
		const season = await setup()
		await seasons.setSeasonField(season._id, { field: "arcs" }, [])
		const start = new Date(Date.now() + 60_000)
		expect(await saveSeasonField(season._id, { field: "start" }, start)).toEqual({ ok: true })
		vi.mocked(publish).mockClear()
		expect(await saveSeasonField(season._id, { field: "start" }, null)).toEqual({ ok: true })
		expect(await seasons.getSeason(season._id)).toMatchObject({ start: null, end: null })
		expect(vi.mocked(publish).mock.calls).toEqual([[seasonChannel(season._id)], [boardChannel]])
	})

	it("updates configured length and the upcoming end together", async () => {
		const season = await setup()
		const start = new Date(Date.now() + 60_000)
		await seasons.setSeasonWindow(season._id, season, { start, end: new Date(start.getTime() + 3_600_000) }, new Date())
		expect(await saveSeasonField(season._id, { field: "lengthMinutes" }, 90)).toEqual({ ok: true })
		expect(await seasons.getSeason(season._id)).toMatchObject({
			start,
			end: new Date(start.getTime() + 5_400_000),
			lengthMinutes: 90,
		})
		expect(vi.mocked(publish).mock.calls).toEqual([[seasonChannel(season._id)], [boardChannel]])
	})

	it.each([0, 1.5, 1441, "60"])("rejects invalid configured length %j", async (value) => {
		const season = await setup()
		expect(await saveSeasonField(season._id, { field: "lengthMinutes" }, value)).toEqual({
			ok: false,
			error: "Invalid value.",
		})
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it.each(["live", "ended"])("locks start and length when %s", async (state) => {
		const season = await setup()
		const now = new Date()
		await seasons.setSeasonWindow(
			season._id,
			season,
			{
				start: new Date(now.getTime() - 60_000),
				end: new Date(now.getTime() + (state === "live" ? 60_000 : -1000)),
			},
			now,
		)
		const before = await seasons.getSeason(season._id)
		for (const [field, value] of [
			["start", null],
			["start", new Date(now.getTime() + 60_000)],
			["lengthMinutes", 90],
		] as const) {
			expect(await saveSeasonField(season._id, { field }, value)).toEqual({
				ok: false,
				error: "Set at start. Use −5 / +5 min while live.",
			})
		}
		expect(await seasons.getSeason(season._id)).toEqual(before)
		expect(publish).not.toHaveBeenCalled()
	})

	it.each(["start", "lengthMinutes"])("%s returns formatted scheduled overlap copy", async (field) => {
		const season = await setup()
		const start = new Date("2099-10-24T17:00:00Z")
		const end = new Date("2099-10-24T18:00:00Z")
		if (field === "lengthMinutes") {
			const earlier = new Date(start.getTime() - 3_600_000)
			await seasons.setSeasonWindow(season._id, season, { start: earlier, end: start }, new Date())
		}
		await seasons.createSeason({ title: "Spring Hunt", lengthMinutes: 60, start, end, shuffleArcs: false, arcs: [] })
		expect(
			await saveSeasonField(season._id, { field: field as "start" | "lengthMinutes" }, field === "start" ? start : 90),
		).toEqual({
			ok: false,
			error: 'Overlaps "Spring Hunt", Sat 24 Oct 19:00–20:00.',
		})
		expect(publish).not.toHaveBeenCalled()
	})

	it("returns stale window errors without publishing", async () => {
		const season = await setup()
		vi.spyOn(seasons, "setSeasonWindow").mockRejectedValueOnce(new seasons.StaleWindowError("Season window changed"))
		expect(await saveSeasonField(season._id, { field: "start" }, new Date(Date.now() + 60_000))).toEqual({
			ok: false,
			error: "Season window changed",
		})
		expect(publish).not.toHaveBeenCalled()
	})

	it.each(["save", "patch"])("checks guard before reading arguments for %s and preserves redirect", async (action) => {
		const season = await setup()
		vi.mocked(requireAdmin).mockImplementationOnce(async () => redirect("/login"))
		const target = {
			...quest,
			get field(): "answers" {
				return "answers"
			},
		}
		const read = vi.spyOn(target, "field", "get")
		await expect(
			action === "save"
				? saveSeasonField(season._id, target, ["new"])
				: patchSeasonList(season._id, target, { op: "add", value: "new" }),
		).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") })
		expect(read).not.toHaveBeenCalled()
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it.each<SeasonFieldTarget>([
		{ field: "arcs" },
		{ arcId: "a1", field: "quests" },
		{ ...quest, field: "answers" },
		{ ...quest, field: "hints" },
		{ ...quest, field: "assetPath" },
		{ field: "registrationOpen" },
	])("rejects list or registration field %j without writing or publishing", async (target) => {
		const season = await setup()
		expect(await saveSeasonField(season._id, target, [])).toEqual({ ok: false, error: "Invalid value." })
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it.each([42, "", "  ", "x".repeat(61)])("rejects invalid season title %j", async (value) => {
		const season = await setup()
		expect(await saveSeasonField(season._id, { field: "title" }, value)).toEqual({ ok: false, error: "Invalid value." })
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it("rejects invalid field values, unknown ids and invalid hint patches without writing or publishing", async () => {
		const season = await setup()
		expect(await saveSeasonField(season._id, { ...quest, field: "points" }, "ten")).toEqual({
			ok: false,
			error: "Use a whole number from 0 to 10000.",
		})
		expect(await saveSeasonField("missing", { field: "title" }, "New")).toMatchObject({
			ok: false,
			error: expect.any(String),
		})
		expect(
			await patchSeasonList(
				season._id,
				{ ...quest, questId: "missing", field: "answers" },
				{ op: "add", value: "new" },
			),
		).toEqual({ ok: false })
		const invalid = { op: "add", hint: { points: 5 } } as unknown as Parameters<typeof patchSeasonList>[2]
		expect(await patchSeasonList(season._id, { ...quest, field: "hints" }, invalid)).toEqual({ ok: false })
		expect(await seasons.getSeason(season._id)).toEqual(season)
		expect(publish).not.toHaveBeenCalled()
	})

	it("keeps both parallel quest displayTitle and content saves", async () => {
		const season = await setup()
		expect(
			await Promise.all([
				saveSeasonField(season._id, { ...quest, field: "displayTitle" }, "New title"),
				saveSeasonField(season._id, { ...quest, field: "content" }, "New content"),
			]),
		).toEqual([{ ok: true }, { ok: true }])
		expect((await seasons.getSeason(season._id))?.arcs[0]?.quests[0]).toMatchObject({
			displayTitle: "New title",
			content: "New content",
		})
	})

	it("trims season title and publishes both channels once after save and patch", async () => {
		const season = await setup()
		expect(await saveSeasonField(season._id, { field: "title" }, "  New title  ")).toEqual({ ok: true })
		expect((await seasons.getSeason(season._id))?.title).toBe("New title")
		expect(vi.mocked(publish).mock.calls).toEqual([[seasonChannel(season._id)], [boardChannel]])
		vi.mocked(publish).mockClear()
		expect(await patchSeasonList(season._id, { ...quest, field: "answers" }, { op: "add", value: "beacon" })).toEqual({
			ok: true,
		})
		expect((await seasons.getSeason(season._id))?.arcs[0]?.quests[0]?.answers).toEqual(["lamp", "beacon"])
		expect(vi.mocked(publish).mock.calls).toEqual([[seasonChannel(season._id)], [boardChannel]])
	})

	it("rejects end autosave even when it would reopen registration", async () => {
		const season = await setup()
		const open = await seasons.createSeason({
			title: "Open",
			lengthMinutes: 60,
			start: null,
			end: null,
			shuffleArcs: false,
			arcs: [],
		})
		const now = new Date()
		await seasons.setSeasonField(season._id, { field: "end" }, new Date(now.getTime() - 1000))
		await seasons.setRegistrationOpen(season._id, true, new Date(now.getTime() - 2000))
		await seasons.setRegistrationOpen(open._id, true)
		const before = await seasons.getSeason(season._id)
		expect(await saveSeasonField(season._id, { field: "end" }, null)).toEqual({ ok: false, error: "Invalid value." })
		expect(await seasons.getSeason(season._id)).toEqual(before)
		expect(publish).not.toHaveBeenCalled()
		await seasons.setRegistrationOpen(open._id, false)
	})

	it.each(["save", "patch"])("rethrows unexpected database errors from %s without publishing", async (action) => {
		const error = new Error("Database unavailable")
		if (action === "save") vi.spyOn(seasons, "setSeasonField").mockRejectedValueOnce(error)
		else vi.spyOn(seasons, "patchSeasonList").mockRejectedValueOnce(error)
		await expect(
			action === "save"
				? saveSeasonField("season", { field: "title" }, "New title")
				: patchSeasonList("season", { ...quest, field: "answers" }, { op: "add", value: "new" }),
		).rejects.toBe(error)
		expect(publish).not.toHaveBeenCalled()
	})
})
