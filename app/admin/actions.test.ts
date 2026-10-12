import { beforeEach, describe, expect, it, vi } from "vitest"
import { requireAdmin } from "@/lib/auth/guards"
import { listSeasons } from "@/lib/db/seasons"
import { useTestDb } from "@/test/db"
import { createSeasonAction } from "./actions"

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn() }))

useTestDb()

beforeEach(() => {
	vi.mocked(requireAdmin).mockReset().mockResolvedValue({ _id: "admin", name: "admin", passwordHash: "hash" })
})

describe("createSeasonAction", () => {
	it("checks admin access before reading or validating the title", async () => {
		vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("Unauthorized"))
		const formData = new FormData()
		const read = vi.spyOn(formData, "get")
		const before = await listSeasons()

		await expect(createSeasonAction({}, formData)).rejects.toThrow("Unauthorized")
		expect(read).not.toHaveBeenCalled()
		expect(await listSeasons()).toEqual(before)
	})

	it.each([null, "", "  ", "x".repeat(61)])("returns a title error without writing for %j", async (title) => {
		const formData = new FormData()
		if (title !== null) formData.set("title", title)
		const before = await listSeasons()

		expect(await createSeasonAction({}, formData)).toEqual({ error: "Season titles are 1 to 60 characters." })
		expect(requireAdmin).toHaveBeenCalledOnce()
		expect(await listSeasons()).toEqual(before)
	})

	it("creates a trimmed, empty 60-minute season and redirects to its id", async () => {
		const formData = new FormData()
		formData.set("title", "  Cipher Night 2026  ")
		const result = createSeasonAction({}, formData)
		await expect(result).rejects.toMatchObject({ digest: expect.stringContaining(";/admin/seasons/") })
		const seasons = await listSeasons()
		expect(seasons).toHaveLength(1)
		const season = seasons[0]
		expect(season).toEqual({
			_id: expect.any(String),
			title: "Cipher Night 2026",
			lengthMinutes: 60,
			start: null,
			end: null,
			shuffleArcs: false,
			registrationOpen: false,
			arcs: [],
		})
		await expect(result).rejects.toMatchObject({ digest: expect.stringContaining(`;/admin/seasons/${season?._id};`) })
	})
})
