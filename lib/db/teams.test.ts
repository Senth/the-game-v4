import { MongoServerError } from "mongodb"
import { describe, expect, it } from "vitest"
import type { Team } from "@/lib/domain/schemas"
import { useTestDb } from "@/test/db"
import { NotFoundError } from "./collections"
import { createTeam, getTeam, listTeams, listTeamsByName, revealHint, setTeamField, solveCurrentQuest } from "./teams"

useTestDb()

function team(name: string, seasonId: string | null): Omit<Team, "_id"> {
	return {
		name,
		passwordHash: "$2b$10$hash",
		seasonId,
		questOrder: [],
		questIndex: 0,
		score: 0,
		completed: false,
		progress: [],
	}
}

describe("teams", () => {
	it("creates, gets and lists teams by season", async () => {
		const ninjas = await createTeam(team("Ninjas", "spring"))
		await createTeam(team("Owls", "spring"))
		await createTeam(team("Foxes", "autumn"))

		expect(await getTeam(ninjas._id)).toEqual(ninjas)
		expect((await listTeams("spring")).map((t) => t.name).sort()).toEqual(["Ninjas", "Owls"])
	})

	it("lists teams by exact name across seasons", async () => {
		await createTeam(team("Herons", "spring"))
		await createTeam(team("Herons", "autumn"))
		await createTeam(team("herons", "summer"))

		expect((await listTeamsByName("Herons")).map((t) => t.seasonId).sort()).toEqual(["autumn", "spring"])
	})

	it("sets one field", async () => {
		const { _id } = await createTeam(team("Bears", "spring"))
		await setTeamField(_id, "score", -15)

		expect(await getTeam(_id)).toMatchObject({ name: "Bears", score: -15 })
	})

	it("rejects an invalid value and a missing team", async () => {
		const { _id } = await createTeam(team("Wolves", "spring"))

		await expect(setTeamField(_id, "questIndex", -1)).rejects.toThrow()
		await expect(setTeamField("missing", "score", 1)).rejects.toThrow(NotFoundError)
		expect(await getTeam(_id)).toMatchObject({ questIndex: 0 })
	})

	it("rejects a duplicate name in one season and allows it in another", async () => {
		await createTeam(team("Hawks", "spring"))

		await expect(createTeam(team("Hawks", "spring"))).rejects.toMatchObject({ code: 11000 })
		await expect(createTeam(team("Hawks", "spring"))).rejects.toBeInstanceOf(MongoServerError)
		await expect(createTeam(team("hAWKS", "spring"))).rejects.toMatchObject({ code: 11000 })
		await expect(createTeam(team("Hawks", "autumn"))).resolves.toMatchObject({ name: "Hawks" })
	})

	describe("atomic game writes", () => {
		const hint = { hintId: "h1", text: "Count the flashes", points: 5, revealedAt: new Date("2026-03-14T18:05:00Z") }
		const q1 = { questIndex: 0, questId: "q1" }
		const solveQ1 = { ...q1, orderLength: 2, hintCount: 0 }

		async function playing() {
			return createTeam({ ...team(crypto.randomUUID(), "spring"), questOrder: ["q1", "q2"] })
		}

		it("adds points and advances once for concurrent solves", async () => {
			const { _id } = await playing()
			const solvedAt = new Date("2026-03-14T18:10:00Z")
			const results = await Promise.all([
				solveCurrentQuest(_id, solveQ1, solvedAt, 50),
				solveCurrentQuest(_id, solveQ1, solvedAt, 50),
			])

			expect(results.sort()).toEqual([false, true])
			expect(await getTeam(_id)).toMatchObject({
				score: 50,
				questIndex: 1,
				completed: false,
				progress: [{ questId: "q1", solvedAt, hintsRevealed: [], pointsEarned: 50 }],
			})
		})

		it("writes nothing for a reveal after the solve or on a non-current quest", async () => {
			const { _id } = await playing()
			expect(await revealHint(_id, { questIndex: 0, questId: "q2" }, hint)).toBe(false)
			expect(await revealHint(_id, { questIndex: 1, questId: "q2" }, hint)).toBe(false)
			expect(await getTeam(_id)).toMatchObject({ progress: [] })

			await solveCurrentQuest(_id, solveQ1, new Date(), 50)
			const solved = await getTeam(_id)
			expect(await revealHint(_id, q1, hint)).toBe(false)
			expect(await getTeam(_id)).toEqual(solved)
		})

		it("does not solve with a stale hint count", async () => {
			const { _id } = await playing()
			expect(await revealHint(_id, q1, hint)).toBe(true)
			const before = await getTeam(_id)

			expect(await solveCurrentQuest(_id, solveQ1, new Date(), 50)).toBe(false)
			expect(await solveCurrentQuest(_id, { ...solveQ1, orderLength: 3, hintCount: 1 }, new Date(), 50)).toBe(false)
			expect(await getTeam(_id)).toEqual(before)
			expect(await solveCurrentQuest(_id, { ...solveQ1, hintCount: 1 }, new Date(), 45)).toBe(true)
		})

		it("sets completed when the last quest is solved", async () => {
			const { _id } = await playing()
			await solveCurrentQuest(_id, solveQ1, new Date(), 50)
			expect(await solveCurrentQuest(_id, { ...solveQ1, questIndex: 1, questId: "q2" }, new Date(), 30)).toBe(true)

			expect(await getTeam(_id)).toMatchObject({ score: 80, questIndex: 2, completed: true })
		})
	})
})
