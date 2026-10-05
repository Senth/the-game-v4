import { MongoServerError } from "mongodb"
import { describe, expect, it } from "vitest"
import type { Team } from "@/lib/domain/schemas"
import { useTestDb } from "@/test/db"
import { NotFoundError } from "./collections"
import { createTeam, getTeam, listTeams, setTeamField } from "./teams"

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
		await expect(createTeam(team("Hawks", "autumn"))).resolves.toMatchObject({ name: "Hawks" })
	})
})
