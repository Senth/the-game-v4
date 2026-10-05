import { MongoClient } from "mongodb"
import { describe, expect, it, vi } from "vitest"
import { useTestDb } from "@/test/db"
import { getDb } from "./client"

useTestDb()

describe("getDb", () => {
	it("closes the client when index setup fails and connects on retry", async () => {
		const uri = process.env.MONGODB_URI ?? ""
		const seeder = new MongoClient(uri)
		const teams = seeder.db().collection("teams")
		await teams.insertMany([
			{ seasonId: "s", name: "Twins" },
			{ seasonId: "s", name: "Twins" },
		])
		const close = vi.spyOn(MongoClient.prototype, "close")

		await expect(getDb()).rejects.toMatchObject({ code: 11000 })
		expect(close).toHaveBeenCalledOnce()
		expect((globalThis as { theGameClient?: MongoClient }).theGameClient).toBeUndefined()

		close.mockRestore()
		await teams.deleteOne({ name: "Twins" })
		await seeder.close()
		await expect(getDb()).resolves.toBeDefined()
	})
})
