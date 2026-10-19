import { describe, expect, it, vi } from "vitest"
import { closeDb } from "@/lib/db/client"
import { useTestDb } from "@/test/db"
import { GET } from "./route"

useTestDb()

describe("GET /api/health", () => {
	it("returns 200 when MongoDB responds to ping", async () => {
		const response = await GET()

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({ ok: true })
	})

	it("returns 503 without exposing errors when MongoDB is unreachable", async () => {
		const configuredUri = process.env.MONGODB_URI
		await closeDb()
		process.env.MONGODB_URI = "mongodb://127.0.0.1:1/health?serverSelectionTimeoutMS=500"
		const logError = vi.spyOn(console, "error").mockImplementation(() => {})

		try {
			const response = await GET()

			expect(response.status).toBe(503)
			await expect(response.json()).resolves.toEqual({ ok: false })
			expect(logError).toHaveBeenCalledOnce()
		} finally {
			process.env.MONGODB_URI = configuredUri
			logError.mockRestore()
		}
	})
})
