import { redirect } from "next/navigation"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { requireAdmin } from "@/lib/auth/guards"
import { searchNominatim } from "@/lib/geocode/nominatim"
import { searchPlaces } from "./geocode-actions"

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/geocode/nominatim", () => ({ searchNominatim: vi.fn() }))

beforeEach(() => {
	vi.mocked(requireAdmin).mockReset().mockResolvedValue({ _id: "admin", name: "admin", passwordHash: "hash" })
	vi.mocked(searchNominatim).mockReset().mockResolvedValue({ ok: true, results: [] })
})

describe("search places action", () => {
	it.each([
		["team", "/"],
		["anonymous", "/login"],
	])("requires admin before inspecting the query for a %s session", async (_session, destination) => {
		vi.mocked(requireAdmin).mockImplementationOnce(async () => redirect(destination))
		const query = {
			get trim() {
				throw new Error("query read before authorization")
			},
		} as unknown as string

		await expect(searchPlaces(query)).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") })
		expect(searchNominatim).not.toHaveBeenCalled()
	})

	it.each(["", " ", "x", "x".repeat(201)])("rejects invalid query %j", async (query) => {
		expect(await searchPlaces(query)).toEqual({ ok: false, error: "invalid-query" })
		expect(searchNominatim).not.toHaveBeenCalled()
	})

	it("trims and delegates valid queries", async () => {
		vi.mocked(searchNominatim).mockResolvedValue({
			ok: true,
			results: [
				{
					name: "Svedala",
					label: "Svedala, Sverige",
					lat: 55.5079,
					lng: 13.2353,
					bbox: ["55.49", "55.52", "13.21", "13.26"],
				},
			],
		})

		expect(await searchPlaces("  Svedala  ")).toEqual({
			ok: true,
			results: [
				{
					name: "Svedala",
					label: "Svedala, Sverige",
					lat: 55.5079,
					lng: 13.2353,
					bbox: ["55.49", "55.52", "13.21", "13.26"],
				},
			],
		})
		expect(searchNominatim).toHaveBeenCalledExactlyOnceWith("Svedala")
	})

	it.each(["x".repeat(2), "x".repeat(200)])("accepts query boundary %j", async (query) => {
		expect(await searchPlaces(query)).toEqual({ ok: true, results: [] })
		expect(searchNominatim).toHaveBeenCalledExactlyOnceWith(query)
	})
})
