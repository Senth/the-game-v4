import { beforeAll, describe, expect, it, vi } from "vitest"
import { createSeason, setRegistrationOpen } from "@/lib/db/seasons"
import { createTeam, listTeams } from "@/lib/db/teams"
import { subscribe } from "@/lib/events/bus"
import { useTestDb } from "@/test/db"
import { verifyPassword } from "./password"
import { registerTeam } from "./register"

useTestDb()

const start = new Date("2026-03-14T18:00:00Z")
const before = new Date(start.getTime() - 3_600_000)
const after = new Date(start.getTime() + 3_600_000)
const ended = new Date(start.getTime() + 3 * 3_600_000)

const quest = (id: string) => ({
	id,
	displayTitle: id,
	internalTitle: id,
	content: "",
	assetPath: null,
	answers: ["x"],
	points: 10,
	adminNotes: "",
	hints: [],
})

const names = async (seasonId: string) => (await listTeams(seasonId)).map((team) => team.name).sort()

beforeAll(async () => {
	await createSeason({
		_id: "open",
		title: "Cipher Night",
		lengthMinutes: 120,
		start,
		end: new Date(start.getTime() + 2 * 3_600_000),
		shuffleArcs: true,
		arcs: [
			{ id: "a", title: "Lighthouse", shuffleQuests: true, quests: [quest("a1"), quest("a2")] },
			{ id: "b", title: "Old Town", shuffleQuests: false, quests: [quest("b1")] },
		],
	})
	await createSeason({
		_id: "other",
		title: "Spring",
		lengthMinutes: 60,
		start: null,
		end: null,
		shuffleArcs: false,
		arcs: [],
	})
	await setRegistrationOpen("open", true, before)
})

describe("registerTeam", () => {
	it("trims the name, hashes the password and gives an empty order before start", async () => {
		const result = await registerTeam("  Ninjas  ", "ninjas", before)

		expect(result).toMatchObject({
			ok: true,
			team: {
				name: "Ninjas",
				seasonId: "open",
				questOrder: [],
				questIndex: 0,
				score: 0,
				completed: false,
				progress: [],
			},
		})
		if (!result.ok) throw new Error("expected ok")
		expect(await verifyPassword("ninjas", result.team.passwordHash)).toBe(true)
	})

	it("builds the order from every quest after start", async () => {
		const result = await registerTeam("Owls", "owls", after)

		if (!result.ok) throw new Error("expected ok")
		expect(result.team.questOrder.toSorted()).toEqual(["a1", "a2", "b1"])
	})

	it("rejects the same name in the season ignoring case and allows it in another season", async () => {
		await createTeam({
			name: "Herons",
			passwordHash: "$2b$10$hash",
			seasonId: "other",
			questOrder: [],
			questIndex: 0,
			score: 0,
			completed: false,
			progress: [],
		})

		expect(await registerTeam("Herons", "herons", before)).toMatchObject({ ok: true })
		expect(await registerTeam("Ninjas", "other", before)).toEqual({ ok: false, error: "taken" })
		expect(await registerTeam("ninjas", "other", before)).toEqual({ ok: false, error: "taken" })
		expect(await names("open")).toEqual(["Herons", "Ninjas", "Owls"])
	})

	it("rejects bad name and password lengths without writing", async () => {
		expect(await registerTeam("   ", "long enough", before)).toEqual({ ok: false, error: "invalid-name" })
		expect(await registerTeam("x".repeat(31), "long enough", before)).toEqual({ ok: false, error: "invalid-name" })
		expect(await registerTeam("Bears", "abc", before)).toEqual({ ok: false, error: "invalid-password" })
		expect(await registerTeam(` ${"y".repeat(30)} `, "abcd", before)).toMatchObject({ ok: true })
		expect(await names("open")).toEqual(["Herons", "Ninjas", "Owls", "y".repeat(30)])
	})

	it("is closed when the open season has ended or none is open", async () => {
		expect(await registerTeam("Foxes", "foxes", ended)).toEqual({ ok: false, error: "closed" })
		await setRegistrationOpen("open", false)
		expect(await registerTeam("Foxes", "foxes", before)).toEqual({ ok: false, error: "closed" })
		await setRegistrationOpen("open", true, before)
		expect((await names("open")).includes("Foxes")).toBe(false)
	})

	it("creates one team when the same name registers concurrently", async () => {
		const results = await Promise.all([registerTeam("Twins", "twins", before), registerTeam("twins", "twins", before)])

		expect(results.map((result) => result.ok).sort()).toEqual([false, true])
		expect(results.find((result) => !result.ok)).toEqual({ ok: false, error: "taken" })
		expect((await names("open")).filter((name) => name.toLowerCase() === "twins")).toHaveLength(1)
	})

	it("publishes once to the season and the board", async () => {
		const season = vi.fn()
		const board = vi.fn()
		const unsubscribe = [subscribe(["season:open"], season), subscribe(["board"], board)]

		await registerTeam("Wolves", "wolves", before)
		await registerTeam("Wolves", "wolves", before)
		unsubscribe.forEach((stop) => {
			stop()
		})

		expect(season.mock.calls).toEqual([[{ channel: "season:open" }]])
		expect(board.mock.calls).toEqual([[{ channel: "board" }]])
	})
})
