import { describe, expect, it } from "vitest"
import { Admin, Season, Team } from "@/lib/domain/schemas"
import { hintPenalty } from "@/lib/domain/scoring"
import { buildFixture } from "./fixture"

const now = new Date("2026-10-05T19:12:30Z")
const { season, teams, admins } = buildFixture(now)
const arcIds = season.arcs.map((arc) => arc.quests.map((quest) => quest.id))
const authored = arcIds.flat()
const quests = new Map(season.arcs.flatMap((arc) => arc.quests.map((quest) => [quest.id, quest] as const)))

const standings: [string, number, number][] = [
	["Rävarna", 9, 120],
	["Team Kaos", 8, 105],
	["Fjällräv", 8, 98],
	["Byggarna", 7, 90],
	["Glada Gänget", 7, 82],
	["Lagom", 6, 70],
	["Ninjas", 5, 64],
	["Kodknäckarna", 4, 50],
	["Sista Laget", 4, 41],
	["Lösenord123", 2, 20],
]

describe("buildFixture", () => {
	it("passes the Season, Team and Admin schemas", () => {
		expect(() => Season.parse(season)).not.toThrow()
		for (const { password, ...team } of teams)
			expect(() => Team.parse({ ...team, passwordHash: password })).not.toThrow()
		for (const { password, ...admin } of admins)
			expect(() => Admin.parse({ ...admin, passwordHash: password })).not.toThrow()
		expect(admins).toEqual([{ _id: "admin", name: "admin", password: "admin" }])
	})

	it("orders every team through contiguous arcs with Finale last and no authored order", () => {
		for (const team of teams) {
			expect([...team.questOrder].sort()).toEqual([...authored].sort())
			expect(team.questOrder).not.toEqual(authored)
			expect(team.questOrder.slice(-3)).toEqual(arcIds[2])
			const arcOf = (questId: string) => arcIds.findIndex((ids) => ids.includes(questId))
			const runs = team.questOrder.map(arcOf).filter((arc, index, all) => arc !== all[index - 1])
			expect(runs).toHaveLength(3)
		}
	})

	it("matches the S1 standings with scores that follow the scoring formula", () => {
		expect(teams.map((team) => [team.name, team.questIndex, team.score])).toEqual(standings)
		for (const team of teams) {
			const solved = team.progress.filter((entry) => entry.solvedAt)
			expect(solved).toHaveLength(team.questIndex)
			expect(team.score).toBe(solved.reduce((sum, entry) => sum + entry.pointsEarned, 0))
			for (const entry of solved) {
				expect(entry.pointsEarned).toBe((quests.get(entry.questId)?.points ?? 0) - hintPenalty(entry.hintsRevealed))
			}
			for (const entry of team.progress) {
				for (const time of [entry.solvedAt, ...entry.hintsRevealed.map((snapshot) => snapshot.revealedAt)]) {
					if (!time) continue
					expect(time.getTime()).toBeGreaterThan(season.start?.getTime() ?? Number.NaN)
					expect(time.getTime()).toBeLessThan(now.getTime())
				}
			}
		}
	})

	it("keeps Ninjas mid-game on Backwards log, two behind pace", () => {
		const ninjas = teams.find((team) => team.name === "Ninjas")
		if (!ninjas || !season.start || !season.end) throw new Error("fixture")
		expect(ninjas.password).toBe("ninjas")
		expect(new Set(ninjas.questOrder.slice(0, 5))).toEqual(new Set(arcIds[1]))
		expect(ninjas.questOrder[ninjas.questIndex]).toBe("backwards-log")
		const current = ninjas.progress.find((entry) => entry.questId === "backwards-log")
		expect(current?.solvedAt).toBeUndefined()
		expect(current?.hintsRevealed.map((snapshot) => snapshot.hintId)).toEqual(["backwards-log-h1"])

		const timeFraction = (now.getTime() - season.start.getTime()) / (season.end.getTime() - season.start.getTime())
		const behindPercent = 100 * timeFraction - (100 * ninjas.questIndex) / authored.length
		expect(Math.round(timeFraction * authored.length) - ninjas.questIndex).toBe(2)
		expect(behindPercent).toBeGreaterThan(10)
		expect(behindPercent).toBeLessThanOrEqual(20)
	})

	it("describes Backwards log as the G2 mock does", () => {
		const backwardsLog = quests.get("backwards-log")
		expect(backwardsLog).toMatchObject({ displayTitle: "The keeper's last log", answers: ["lighthouse", "fyren"] })
		expect(backwardsLog?.hints.map((hint) => hint.points)).toEqual([5, 10, 20])
		expect(backwardsLog?.assetPath).toMatch(/^\/assets\/[0-9a-f-]{36}\.png$/)
	})
})
