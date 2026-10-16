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
		await teams.dropIndex("name_1")
		await teams.createIndex({ name: 1 })

		await ensureIndexes(db)

		expect((await teams.indexes()).map((index) => index.name).sort()).toEqual(["_id_", "name_1", "season_name_ci"])
		expect((await teams.indexes()).find((index) => index.name === "name_1")).toMatchObject({
			key: { name: 1 },
			collation: { locale: "en", strength: 2 },
		})
	})
})
