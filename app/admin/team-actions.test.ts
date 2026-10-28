import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { requireTeam } from "@/lib/auth/guards"
import { joinToken, verifyJoinToken } from "@/lib/auth/join"
import { verifyPassword } from "@/lib/auth/password"
import { getSession } from "@/lib/auth/session"
import { collections } from "@/lib/db/collections"
import { ensurePhone, listTeamPhones } from "@/lib/db/phones"
import { createSeason } from "@/lib/db/seasons"
import * as teams from "@/lib/db/teams"
import { newArc, newQuest } from "@/lib/domain/season-tree"
import { publish } from "@/lib/events/bus"
import { allowedChannels, authorizeChannels } from "@/lib/events/channels"
import { useTestDb } from "@/test/db"
import { createTeamAction, deleteTeamAction, resetTeamPasswordAction } from "./team-actions"

vi.mock("@/lib/auth/session", async (original) => ({
	...(await original<typeof import("@/lib/auth/session")>()),
	getSession: vi.fn(),
}))
vi.mock("@/lib/events/bus", async (original) => ({
	...(await original<typeof import("@/lib/events/bus")>()),
	publish: vi.fn(),
}))

useTestDb()
const now = new Date("2026-10-24T17:00:00Z")

function form(name = "  Ninjas  ", password = "ninjas") {
	const data = new FormData()
	data.set("name", name)
	data.set("password", password)
	return data
}

async function setup(start: Date | null = null) {
	return createSeason({
		_id: "season",
		title: "Cipher Night",
		lengthMinutes: 60,
		start,
		end: start ? new Date(start.getTime() + 3_600_000) : null,
		shuffleArcs: false,
		arcs: [
			{
				...newArc(false),
				quests: [
					{ ...newQuest(), id: "q1" },
					{ ...newQuest(), id: "q2" },
				],
			},
		],
	})
}

async function existing(seasonId = "season", name = "Ninjas") {
	return teams.createTeam({
		name,
		seasonId,
		passwordHash: "hash",
		questOrder: ["q1", "q2"],
		questIndex: 1,
		score: 15,
		completed: false,
		progress: [{ questId: "q1", solvedAt: now, pointsEarned: 15, hintsRevealed: [] }],
	})
}

beforeEach(async () => {
	vi.restoreAllMocks()
	vi.setSystemTime(now)
	const db = await collections()
	await db.seasons.deleteMany({})
	await db.teams.deleteMany({})
	await db.admins.deleteMany({})
	await db.admins.insertOne({ _id: "admin", name: "admin", passwordHash: "hash" })
	vi.mocked(getSession)
		.mockReset()
		.mockResolvedValue({ kind: "admin", id: "admin" } as Awaited<ReturnType<typeof getSession>>)
	vi.mocked(publish).mockClear()
})

afterEach(() => vi.useRealTimers())

describe.each(["create", "delete", "reset"] as const)("%s team action", (action) => {
	const run = (seasonId = "season", teamId = "team") =>
		action === "create"
			? createTeamAction(seasonId, {}, form())
			: action === "delete"
				? deleteTeamAction(seasonId, teamId)
				: resetTeamPasswordAction(seasonId, teamId, {}, form())

	it.each([{}, { kind: "team", id: "team" }, { kind: "admin", id: "missing" }])(
		"refuses session %j before validation or writes",
		async (session) => {
			await setup()
			const team = await existing()
			vi.mocked(getSession).mockResolvedValueOnce(session as Awaited<ReturnType<typeof getSession>>)
			await expect(run("", "")).rejects.toMatchObject({ digest: expect.stringContaining(";/login;") })
			expect(await teams.listTeams("season")).toEqual([team])
			expect(publish).not.toHaveBeenCalled()
		},
	)

	it.each(["", null, 42])("rejects invalid season id %j without publishing", async (invalid) => {
		await setup()
		const team = await existing()
		expect(await run(invalid as string, team._id)).toEqual({ ok: false, error: "Invalid value." })
		expect(await teams.listTeams("season")).toEqual([team])
		expect(publish).not.toHaveBeenCalled()
	})

	it("rethrows unexpected database failures without publishing", async () => {
		await setup()
		const team = await existing()
		const error = new Error("Database unavailable")
		vi.spyOn(
			teams,
			action === "create" ? "createTeam" : action === "delete" ? "deleteTeam" : "setTeamField",
		).mockRejectedValueOnce(error)
		await expect(run("season", team._id)).rejects.toBe(error)
		expect(publish).not.toHaveBeenCalled()
	})
})

describe("createTeamAction", () => {
	it.each([null, new Date(now.getTime() + 60_000), now, new Date(now.getTime() - 7_200_000)])(
		"adds with registration closed at start %j and publishes once after writing",
		async (start) => {
			const season = await setup(start)
			expect(season.registrationOpen).toBe(false)
			expect(await createTeamAction("season", {}, form())).toEqual({ ok: true })
			const [team] = await teams.listTeams("season")
			if (!team) throw new Error("expected team")
			expect(team).toMatchObject({
				name: "Ninjas",
				seasonId: "season",
				questIndex: 0,
				score: 0,
				completed: false,
				progress: [],
				questOrder: start && start <= now ? ["q1", "q2"] : [],
			})
			expect(await verifyPassword("ninjas", team.passwordHash)).toBe(true)
			expect(vi.mocked(publish).mock.calls).toEqual([["season:season"], ["board"]])
		},
	)

	it.each([
		["   ", "password", "Team names are 1 to 30 characters."],
		["x".repeat(31), "password", "Team names are 1 to 30 characters."],
		["Ninjas", "abc", "Passwords need at least 4 characters."],
	])("rejects invalid credentials %j", async (name, password, error) => {
		await setup()
		expect(await createTeamAction("season", {}, form(name, password))).toEqual({ ok: false, error })
		expect(await teams.listTeams("season")).toEqual([])
		expect(publish).not.toHaveBeenCalled()
	})

	it("accepts boundary lengths and rejects missing fields and file credentials", async () => {
		await setup()
		expect(await createTeamAction("season", {}, form(` ${"x".repeat(30)} `, "abcd"))).toEqual({ ok: true })
		vi.mocked(publish).mockClear()
		expect(await createTeamAction("season", {}, new FormData())).toEqual({
			ok: false,
			error: "Team names are 1 to 30 characters.",
		})
		const data = form()
		data.set("password", new Blob(["secret"]), "password.txt")
		expect(await createTeamAction("season", {}, data)).toEqual({ ok: false, error: "Invalid value." })
		expect(publish).not.toHaveBeenCalled()
	})

	it("maps exact and differently cased duplicates and allows other seasons", async () => {
		await setup()
		await existing()
		for (const name of ["Ninjas", "nINJAS"]) {
			expect(await createTeamAction("season", {}, form(name))).toEqual({
				ok: false,
				error: `${name} is taken this season. Pick another name.`,
			})
		}
		expect(publish).not.toHaveBeenCalled()
		await existing("other", "Owls")
		expect(await createTeamAction("season", {}, form("Owls"))).toEqual({ ok: true })
	})

	it("creates one team and publishes once for concurrent case-insensitive duplicates", async () => {
		await setup()
		const results = await Promise.all([
			createTeamAction("season", {}, form("Ninjas")),
			createTeamAction("season", {}, form("ninjas")),
		])
		expect(results.map((result) => result.ok).sort()).toEqual([false, true])
		expect(await teams.listTeams("season")).toHaveLength(1)
		expect(vi.mocked(publish).mock.calls).toEqual([["season:season"], ["board"]])
	})

	it("rejects a missing season without writing", async () => {
		expect(await createTeamAction("missing", {}, form())).toEqual({ ok: false, error: "Season missing not found" })
		expect(await teams.listTeams("missing")).toEqual([])
		expect(publish).not.toHaveBeenCalled()
	})
})

describe("resetTeamPasswordAction", () => {
	it.each([null, now, new Date(now.getTime() - 7_200_000)])(
		"resets at start %j, keeps sessions and progress, invalidates old join tokens and publishes once",
		async (start) => {
			await setup(start)
			await createTeamAction("season", {}, form())
			const [team] = await teams.listTeams("season")
			if (!team) throw new Error("expected team")
			const token = joinToken(team)
			expect(await verifyJoinToken(token)).toEqual(team)
			vi.mocked(publish).mockClear()
			expect(await resetTeamPasswordAction("season", team._id, {}, form("", "abcd"))).toEqual({ ok: true })
			const updated = await teams.getTeam(team._id)
			if (!updated) throw new Error("expected team")
			expect(updated).toEqual({ ...team, passwordHash: expect.any(String) })
			expect(await verifyPassword("abcd", updated.passwordHash)).toBe(true)
			expect(await verifyPassword("ninjas", updated.passwordHash)).toBe(false)
			expect(await verifyJoinToken(token)).toBeNull()
			expect(await verifyJoinToken(joinToken(updated))).toEqual(updated)
			expect(vi.mocked(publish).mock.calls).toEqual([[`team:${team._id}`]])
			vi.mocked(getSession).mockResolvedValueOnce({ kind: "team", id: team._id } as Awaited<
				ReturnType<typeof getSession>
			>)
			expect(await requireTeam()).toEqual(updated)
		},
	)

	it("rejects short, missing and file passwords without writing or publishing", async () => {
		const team = await existing()
		const file = form()
		file.set("password", new Blob(["secret"]), "password.txt")
		for (const [data, error] of [
			[form("", "abc"), "Passwords need at least 4 characters."],
			[new FormData(), "Passwords need at least 4 characters."],
			[file, "Invalid value."],
		] as const) {
			expect(await resetTeamPasswordAction("season", team._id, {}, data)).toEqual({ ok: false, error })
		}
		expect(await teams.getTeam(team._id)).toEqual(team)
		expect(publish).not.toHaveBeenCalled()
	})

	it.each(["", null, 42])("validates team id %j", async (invalid) => {
		expect(await resetTeamPasswordAction("season", invalid as string, {}, form())).toEqual({
			ok: false,
			error: "Invalid value.",
		})
		expect(publish).not.toHaveBeenCalled()
	})

	it("refuses missing and other-season teams without writing or publishing", async () => {
		const other = await existing("other")
		for (const teamId of [other._id, "missing"]) {
			expect(await resetTeamPasswordAction("season", teamId, {}, form())).toEqual({
				ok: false,
				error: `Team ${teamId} not found`,
			})
		}
		expect(await teams.getTeam(other._id)).toEqual(other)
		expect(publish).not.toHaveBeenCalled()
	})
})

describe("deleteTeamAction", () => {
	it.each([null, now, new Date(now.getTime() - 7_200_000)])(
		"deletes at any start %j and invalidates old session and channels",
		async (start) => {
			await setup(start)
			const removed = await existing()
			const kept = await existing("season", "Owls")
			await ensurePhone(removed._id, crypto.randomUUID(), now)
			const keptPhone = await ensurePhone(kept._id, crypto.randomUUID(), now)
			const session = { kind: "team", id: removed._id } as const
			expect(authorizeChannels([`team:${removed._id}`], allowedChannels(session, removed))).toBe(true)
			expect(await deleteTeamAction("season", removed._id)).toEqual({ ok: true })
			expect(await teams.getTeam(removed._id)).toBeNull()
			expect(await teams.getTeam(kept._id)).toEqual(kept)
			expect(await listTeamPhones(removed._id)).toEqual([])
			expect(await listTeamPhones(kept._id)).toEqual([keptPhone.phone])
			expect(vi.mocked(publish).mock.calls).toEqual([[`team:${removed._id}`], ["season:season"], ["board"]])
			vi.mocked(getSession).mockResolvedValueOnce(session as Awaited<ReturnType<typeof getSession>>)
			await expect(requireTeam()).rejects.toMatchObject({ digest: expect.stringContaining(";/login;") })
			expect(
				authorizeChannels([`team:${removed._id}`], allowedChannels(session, await teams.getTeam(removed._id))),
			).toBe(false)
		},
	)

	it.each(["", null, 42])("validates team id %j", async (invalid) => {
		expect(await deleteTeamAction("season", invalid as string)).toEqual({ ok: false, error: "Invalid value." })
		expect(publish).not.toHaveBeenCalled()
	})

	it("refuses missing and other-season teams without deleting or publishing", async () => {
		const other = await existing("other")
		for (const teamId of [other._id, "missing"]) {
			expect(await deleteTeamAction("season", teamId)).toEqual({ ok: false, error: `Team ${teamId} not found` })
		}
		expect(await teams.getTeam(other._id)).toEqual(other)
		expect(publish).not.toHaveBeenCalled()
	})

	it("publishes only for the successful delete when requests race", async () => {
		const team = await existing()
		const results = await Promise.all([deleteTeamAction("season", team._id), deleteTeamAction("season", team._id)])
		expect(results.map((result) => result.ok).sort()).toEqual([false, true])
		expect(vi.mocked(publish).mock.calls).toEqual([[`team:${team._id}`], ["season:season"], ["board"]])
	})
})
