import { access, readdir, rm } from "node:fs/promises"
import { MongoClient } from "mongodb"
import { afterAll, describe, expect, it, vi } from "vitest"
import { getDb } from "@/lib/db/client"
import { getSeason } from "@/lib/db/seasons"
import { maxAssetBytes } from "@/lib/domain/assets"
import { useTestDb } from "@/test/db"
import fixture from "../test/fixtures/v3-export.json"
import { runV3Import } from "./import-v3"

useTestDb()

describe("runV3Import", () => {
	const assetsDir = `.tmp/test-assets-${crypto.randomUUID()}`
	process.env.ASSETS_DIR = assetsDir
	afterAll(async () => {
		vi.unstubAllGlobals()
		await rm(assetsDir, { recursive: true, force: true })
	})

	it("dry-runs without creating collections or changing indexes", async () => {
		const client = new MongoClient(process.env.MONGODB_URI ?? "")
		await client.connect()
		const db = client.db()
		const teams = db.collection("teams")
		await teams.createIndex({ seasonId: 1, name: 1 })
		const collectionsBefore = (await db.listCollections().toArray()).map(({ name }) => name).toSorted()
		const indexesBefore = await teams.listIndexes().toArray()

		try {
			await runV3Import(fixture, true)
			expect((await db.listCollections().toArray()).map(({ name }) => name).toSorted()).toEqual(collectionsBefore)
			expect(await teams.listIndexes().toArray()).toEqual(indexesBefore)
		} finally {
			await client.close()
		}
	})

	it("dry-runs without writes, imports assets once, skips existing seasons, and records download failures", async () => {
		const db = await getDb()
		const log = vi.spyOn(console, "log").mockImplementation(() => {})
		const fetchStub = vi.fn(async (input: string | URL | Request) => {
			const url = String(input)
			if (url.endsWith("lighthouse.png")) return new Response(null, { status: 404 })
			if (url.endsWith("bells.jpg")) return new Response(new Uint8Array(maxAssetBytes + 1))
			if (url.endsWith("log.pdf")) return new Response(new TextEncoder().encode("%PDF-1.4"))
			return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
		})
		vi.stubGlobal("fetch", fetchStub)

		const dryRun = await runV3Import(fixture, true)
		expect(dryRun).toMatchObject({ imported: 0, skipped: 0 })
		expect(fetchStub).not.toHaveBeenCalled()
		expect(await db.collection("seasons").countDocuments()).toBe(0)
		await expect(access(assetsDir)).rejects.toThrow()
		expect(log).toHaveBeenCalledWith(expect.stringContaining("assets to download"))

		const imported = await runV3Import(fixture)
		expect(imported.imported).toBe(2)
		expect(imported.skipped).toBe(0)
		expect(imported.warnings.join("\n")).toContain("v3 asset not imported: https://example.com/lighthouse.png")
		expect(imported.warnings.join("\n")).toContain("v3 asset not imported: https://example.com/bells.jpg")
		expect(fetchStub).toHaveBeenCalledTimes(4)
		expect(fetchStub.mock.calls.filter(([url]) => String(url).endsWith("log.pdf"))).toHaveLength(1)
		expect(await readdir(assetsDir)).toHaveLength(2)

		const first = await getSeason("cipher-2023")
		const second = await getSeason("cipher-2024")
		const firstQuest = first?.arcs[0]?.quests[0]
		const secondQuest = second?.arcs[0]?.quests[0]
		expect(firstQuest?.assetPath).toMatch(/^\/assets\//)
		expect(secondQuest?.assetPath).toBe(firstQuest?.assetPath)
		expect(firstQuest?.adminNotes).toContain("v3 asset not imported: https://example.com/lighthouse.png")
		expect(first?.arcs[1]?.quests[0]?.adminNotes).toContain("v3 asset not imported: https://example.com/bells.jpg")

		fetchStub.mockClear()
		const rerun = await runV3Import(fixture)
		expect(rerun).toMatchObject({ imported: 0, skipped: 2 })
		expect(fetchStub).not.toHaveBeenCalled()
		expect(log).toHaveBeenCalledWith(expect.stringContaining("exists, skipped"))
		log.mockRestore()
	})
})
