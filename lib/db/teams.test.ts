import { Collection, MongoServerError } from "mongodb"
import { describe, expect, it, vi } from "vitest"
import type { Season, Team } from "@/lib/domain/schemas"
import { useTestDb } from "@/test/db"
import { collections, NotFoundError } from "./collections"
import {
	countTeams,
	createTeam,
	deleteTeam,
	editSeasonTeamOrders,
	fillQuestOrders,
	getTeam,
	listSeasonTeams,
	listTeams,
	listTeamsByName,
	revealHint,
	setTeamField,
	solveCurrentQuest,
} from "./teams"

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
	it("lists only the season's teams without password hashes", async () => {
		const first = await createTeam(team("Safe first", "safe-list"))
		const second = await createTeam(team("Owls", "safe-list"))
		await createTeam(team("Foxes", "other-list"))
		const rows = await listSeasonTeams("safe-list")
		expect(rows.map((row) => row._id).sort()).toEqual([first._id, second._id].sort())
		for (const row of rows) {
			expect(row).not.toHaveProperty("passwordHash")
			expect({ ...row, passwordHash: first.passwordHash }).toEqual(row._id === first._id ? first : second)
		}
		expect(await listSeasonTeams("empty-list")).toEqual([])
		expect(await getTeam(first._id)).toEqual(first)
	})

	it("deletes only the requested team and reports a missing team", async () => {
		const removed = await createTeam(team("Delete first", "delete"))
		const kept = await createTeam(team("Owls", "delete"))
		expect(await deleteTeam(removed._id)).toBe(true)
		expect(await getTeam(removed._id)).toBeNull()
		expect(await getTeam(kept._id)).toEqual(kept)
		expect(await deleteTeam(removed._id)).toBe(false)
	})

	it("creates, gets and lists teams by season", async () => {
		const tigers = await createTeam(team("Tigers", "spring"))
		await createTeam(team("Owls", "spring"))
		await createTeam(team("Foxes", "autumn"))

		expect(await getTeam(tigers._id)).toEqual(tigers)
		expect((await listTeams("spring")).map((t) => t.name).sort()).toEqual(["Owls", "Tigers"])
	})

	it("lists teams by case-insensitive name across seasons", async () => {
		await createTeam(team("Ninjas", "login-spring"))
		await createTeam(team("Ninjas", "login-autumn"))

		for (const name of ["ninjas", "NINJAS"]) {
			expect((await listTeamsByName(name)).map((t) => t.seasonId).sort()).toEqual(["login-autumn", "login-spring"])
		}
	})

	it("counts only teams assigned to the requested season", async () => {
		await createTeam(team("Ninjas", "count-spring"))
		await createTeam(team("Owls", "count-spring"))
		await createTeam(team("Foxes", "count-autumn"))
		await createTeam(team("Bears", null))

		expect(await countTeams("count-spring")).toBe(2)
		expect(await countTeams("count-autumn")).toBe(1)
		expect(await countTeams("count-empty")).toBe(0)
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

		async function playing(seasonId = "spring") {
			return createTeam({ ...team(crypto.randomUUID(), seasonId), questOrder: ["q1", "q2"] })
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
				reachedAt: solvedAt,
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

		it.each(["solve", "reveal"])("re-reads and retries structural writes after a concurrent %s", async (kind) => {
			const seasonId = crypto.randomUUID()
			const input = await playing(seasonId)
			const original = Collection.prototype.updateOne
			const write = vi.spyOn(Collection.prototype, "updateOne").mockImplementationOnce(async function (
				this: Collection,
				...args
			) {
				if (kind === "solve") expect(await solveCurrentQuest(input._id, solveQ1, hint.revealedAt, 50)).toBe(true)
				else expect(await revealHint(input._id, q1, hint)).toBe(true)
				return original.apply(this, args)
			})
			try {
				const affected = await editSeasonTeamOrders(seasonId, { kind: "deleteQuest", questIds: ["q1"] })
				const stored = await getTeam(input._id)
				if (kind === "solve") {
					expect(affected).not.toContain(input._id)
					expect(stored).toEqual({
						...input,
						questIndex: 1,
						reachedAt: hint.revealedAt,
						score: 50,
						progress: [{ questId: "q1", solvedAt: hint.revealedAt, pointsEarned: 50, hintsRevealed: [] }],
					})
				} else {
					expect(affected).toContain(input._id)
					expect(stored).toEqual({
						...input,
						questOrder: ["q2"],
						reachedAt: expect.any(Date),
						progress: [{ questId: "q1", hintsRevealed: [hint], pointsEarned: 0 }],
					})
				}
			} finally {
				write.mockRestore()
			}
		})

		it("makes a solve stale when deleting the current quest wins", async () => {
			const seasonId = crypto.randomUUID()
			const input = await playing(seasonId)
			await editSeasonTeamOrders(seasonId, { kind: "deleteQuest", questIds: ["q1"] })
			expect(await solveCurrentQuest(input._id, solveQ1, hint.revealedAt, 50)).toBe(false)
			expect(await getTeam(input._id)).toEqual({
				...input,
				questOrder: ["q2"],
				reachedAt: expect.any(Date),
				progress: [{ questId: "q1", hintsRevealed: [], pointsEarned: 0 }],
			})
		})

		it("does not add a published quest twice when a fresh order build already contains it", async () => {
			const seasonId = crypto.randomUUID()
			const input = await playing(seasonId)
			const edit = { kind: "addQuest", questId: "q2" } as const
			expect(await editSeasonTeamOrders(seasonId, edit)).not.toContain(input._id)
			expect(await getTeam(input._id)).toEqual(input)
		})
	})
})

describe("fillQuestOrders", () => {
	function season(): Season {
		return {
			finisherBonuses: [],
			finishers: [],
			_id: crypto.randomUUID(),
			title: "Order fill",
			start: new Date("2026-10-24T17:00:00Z"),
			end: new Date("2026-10-24T18:00:00Z"),
			lengthMinutes: 60,
			defaultQuestPoints: null,
			registrationOpen: false,
			shuffleArcs: true,
			arcs: ["a1", "a2"].map((id) => ({
				id,
				title: id,
				shuffleQuests: true,
				quests: [1, 2].map((index) => ({
					id: `${id}-q${index}`,
					displayTitle: "Quest",
					internalTitle: "",
					content: "",
					assetPath: null,
					answers: [],
					points: null,
					adminNotes: "",
					hints: [],
				})),
			})),
		}
	}

	it("fills each team once under ten concurrent calls and every caller reads the same orders", async () => {
		const input = season()
		await (await collections()).seasons.insertOne(input)
		const teams = await Promise.all(["Ninjas", "Owls", "Foxes"].map((name) => createTeam(team(name, input._id))))
		const before = structuredClone({ input, teams })
		const results = await Promise.all(
			Array.from({ length: 10 }, async (_, index) => {
				await fillQuestOrders(input, teams, () => (index % 2 === 0 ? 0 : 0.999))
				return listTeams(input._id)
			}),
		)
		const stored = await listTeams(input._id)
		for (const result of results) expect(result).toEqual(stored)
		for (const original of teams) {
			const filled = stored.find((value) => value._id === original._id)
			expect(filled?.questOrder.toSorted()).toEqual(["a1-q1", "a1-q2", "a2-q1", "a2-q2"])
			expect(filled).toEqual({ ...original, questOrder: filled?.questOrder, reachedAt: expect.any(Date) })
		}
		expect(await fillQuestOrders(input, teams)).toBe(false)
		expect({ input, teams }).toEqual(before)
	})

	it("reports exactly one winning caller for one team", async () => {
		const input = season()
		await (await collections()).seasons.insertOne(input)
		const teams = [await createTeam(team("Ninjas", input._id))]
		const results = await Promise.all(Array.from({ length: 10 }, () => fillQuestOrders(input, teams)))
		expect(results.filter(Boolean)).toHaveLength(1)
	})

	it("leaves existing orders, progress and other seasons untouched even with stale team input", async () => {
		const input = season()
		await (await collections()).seasons.insertOne(input)
		const ordered = await createTeam(team("Ordered", input._id))
		const progressed = await createTeam(team("Progressed", input._id))
		const other = await createTeam(team("Other", null))
		await setTeamField(ordered._id, "questOrder", ["existing"])
		await setTeamField(progressed._id, "progress", [{ questId: "old", hintsRevealed: [], pointsEarned: 10 }])
		const before = await Promise.all([getTeam(ordered._id), getTeam(progressed._id), getTeam(other._id)])
		expect(await fillQuestOrders(input, [ordered, progressed, other])).toBe(false)
		expect(await fillQuestOrders(input, [{ ...other, seasonId: input._id }])).toBe(false)
		expect(await Promise.all([getTeam(ordered._id), getTeam(progressed._id), getTeam(other._id)])).toEqual(before)
	})

	it("writes nothing for an empty season or an empty team list", async () => {
		const input = { ...season(), arcs: [] }
		await (await collections()).seasons.insertOne(input)
		const ninjas = await createTeam(team("Ninjas", input._id))
		expect(await fillQuestOrders(input, [ninjas])).toBe(false)
		expect(await fillQuestOrders(season(), [])).toBe(false)
		expect(await getTeam(ninjas._id)).toEqual(ninjas)
	})

	it.each([false, true])("skips hidden drafts when filling orders, all hidden %s", async (allHidden) => {
		const input = season()
		input.arcs = input.arcs.map((arc) => ({
			...arc,
			quests: arc.quests.map((quest, index) => ({ ...quest, hidden: allHidden || index === 0 })),
		}))
		await (await collections()).seasons.insertOne(input)
		const ninjas = await createTeam(team("Ninjas", input._id))
		const original = structuredClone({ input, ninjas })
		expect(await fillQuestOrders(input, [ninjas])).toBe(!allHidden)
		expect((await getTeam(ninjas._id))?.questOrder.toSorted()).toEqual(allHidden ? [] : ["a1-q2", "a2-q2"])
		expect({ input, ninjas }).toEqual(original)
	})
})
