import { describe, expect, it } from "vitest"
import { getDb } from "@/lib/db/client"
import { useTestDb } from "@/test/db"
import { ensureIndexes } from "./indexes"

useTestDb()

describe("ensureIndexes", () => {
	it("replaces the case-sensitive season name index on an existing database", async () => {
		const db = await getDb()
		const teams = db.collection("teams")
		await teams.dropIndex("season_name_ci")
		await teams.createIndex({ seasonId: 1, name: 1 }, { unique: true })

		await ensureIndexes(db)

		expect((await teams.indexes()).map((index) => index.name).sort()).toEqual(["_id_", "name_1", "season_name_ci"])
	})
})
