import { afterAll, beforeAll, inject } from "vitest"
import { closeDb, getDb } from "@/lib/db/client"

export function useTestDb() {
	beforeAll(async () => {
		const uri = new URL(inject("mongoUri"))
		uri.pathname = `/test-${crypto.randomUUID()}`
		process.env.MONGODB_URI = uri.toString()
		await getDb()
	})
	afterAll(async () => {
		await (await getDb()).dropDatabase()
		await closeDb()
	})
}
