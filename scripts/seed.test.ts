import { access, rm } from "node:fs/promises"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { verifyPassword } from "@/lib/auth/password"
import { getDb } from "@/lib/db/client"
import { useTestDb } from "@/test/db"
import { backwardsLogAsset } from "./fixture"
import { assertSeedTarget, isEmpty, seed } from "./seed"

useTestDb()

describe("seed", () => {
	const assetsDir = `.tmp/test-assets-${crypto.randomUUID()}`
	process.env.ASSETS_DIR = assetsDir
	afterAll(() => rm(assetsDir, { recursive: true, force: true }))

	it("loads the fixture, reloads it on a second run and hashes passwords", async () => {
		const db = await getDb()
		const counts = async () =>
			Promise.all(["seasons", "teams", "admins"].map((name) => db.collection(name).countDocuments()))

		expect(await isEmpty(db)).toBe(true)
		await seed(db, new Date())
		expect(await counts()).toEqual([1, 10, 1])
		await seed(db, new Date())
		expect(await counts()).toEqual([1, 10, 1])
		expect(await isEmpty(db)).toBe(false)

		const ninjas = await db.collection("teams").findOne({ name: "Ninjas" })
		expect(await verifyPassword("ninjas", ninjas?.passwordHash)).toBe(true)
		await expect(access(path.join(assetsDir, path.basename(backwardsLogAsset)))).resolves.toBeUndefined()
	})
})

describe("assertSeedTarget", () => {
	it("accepts local hosts", () => {
		expect(() => assertSeedTarget("mongodb://127.0.0.1:27018/the-game", "development", false)).not.toThrow()
		expect(() => assertSeedTarget("mongodb://localhost/the-game", undefined, false)).not.toThrow()
	})

	it("rejects a remote host and production unless forced", () => {
		expect(() => assertSeedTarget("mongodb://mongo:27017/x", undefined, false)).toThrow(/non-local/)
		expect(() => assertSeedTarget("mongodb://127.0.0.1:27018/x", "production", false)).toThrow(/production/)
		expect(() => assertSeedTarget("mongodb://mongo:27017/x", "production", true)).not.toThrow()
	})
})
