import { beforeAll, describe, expect, it } from "vitest"
import { createAdmin } from "@/lib/db/admins"
import { createSeason, setRegistrationOpen } from "@/lib/db/seasons"
import { createTeam } from "@/lib/db/teams"
import { useTestDb } from "@/test/db"
import { authenticate } from "./login"
import { hashPassword } from "./password"

useTestDb()

const now = new Date("2026-03-14T18:00:00Z")
const hour = 3_600_000
const at = (hours: number) => new Date(now.getTime() + hours * hour)

async function team(name: string, password: string, seasonId: string) {
	const { _id } = await createTeam({
		name,
		passwordHash: await hashPassword(password),
		seasonId,
		questOrder: [],
		questIndex: 0,
		score: 0,
		completed: false,
		progress: [],
	})
	return _id
}

beforeAll(async () => {
	const season = { title: "Cipher Night", lengthMinutes: 120, shuffleArcs: false, arcs: [] }
	await createSeason({ ...season, _id: "older", start: at(-48), end: at(-46) })
	await createSeason({ ...season, _id: "newer", start: at(-24), end: at(-22) })
	await createSeason({ ...season, _id: "open", start: null, end: null })
	await setRegistrationOpen("open", true, now)
})

describe("authenticate", () => {
	it("picks the team in the season with registration open when name and password repeat", async () => {
		await team("Ninjas", "ninjas", "older")
		const open = await team("Ninjas", "ninjas", "open")
		await team("Ninjas", "ninjas", "newer")

		expect(await authenticate(" Ninjas ", "ninjas", now)).toEqual({ kind: "team", id: open })
		expect(await authenticate("ninjas", "ninjas", now)).toBeNull()
	})

	it("picks the most recently started season when none is in the open season", async () => {
		await team("Owls", "owls", "older")
		const newer = await team("Owls", "owls", "newer")

		expect(await authenticate("Owls", "owls", now)).toEqual({ kind: "team", id: newer })
	})

	it("only considers teams whose password matches", async () => {
		const older = await team("Foxes", "red", "older")
		await team("Foxes", "silver", "newer")

		expect(await authenticate("Foxes", "red", now)).toEqual({ kind: "team", id: older })
	})

	it("lets an admin win over a team with the same name and password", async () => {
		const admin = await createAdmin({ name: "Boss", passwordHash: await hashPassword("boss") })
		await team("Boss", "boss", "open")

		expect(await authenticate("Boss", "boss", now)).toEqual({ kind: "admin", id: admin._id })
	})

	it("falls through to the team on a wrong admin password", async () => {
		await createAdmin({ name: "Chief", passwordHash: await hashPassword("admin-secret") })
		const chief = await team("Chief", "team-secret", "open")

		expect(await authenticate("Chief", "team-secret", now)).toEqual({ kind: "team", id: chief })
	})

	it("returns null for a wrong password or an unknown name", async () => {
		await team("Bears", "bears", "open")

		expect(await authenticate("Bears", "wolves", now)).toBeNull()
		expect(await authenticate("Chief", "wrong", now)).toBeNull()
		expect(await authenticate("Nobody", "bears", now)).toBeNull()
	})
})
