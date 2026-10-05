import { afterAll, beforeAll, inject } from "vitest"
import { closeDb, getDb } from "@/lib/db/client"

export function useTestDb() {
	beforeAll(() => {
		const uri = new URL(inject("mongoUri"))
		uri.pathname = `/test-${crypto.randomUUID()}`
		process.env.MONGODB_URI = uri.toString()
	})
	afterAll(async () => {
		await (await getDb()).dropDatabase()
		await closeDb()
	})
}
