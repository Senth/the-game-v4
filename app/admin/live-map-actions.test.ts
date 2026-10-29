import { redirect } from "next/navigation"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { requireAdmin } from "@/lib/auth/guards"
import { type LivePhones, loadLivePhones } from "@/lib/game/live-map"
import { getLivePhones } from "./live-map-actions"

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/game/live-map", () => ({ loadLivePhones: vi.fn() }))

beforeEach(() => {
	vi.mocked(requireAdmin).mockReset().mockResolvedValue({ _id: "admin", name: "admin", passwordHash: "hash" })
	vi.mocked(loadLivePhones).mockReset()
})

describe("getLivePhones", () => {
	it.each([
		["anonymous", "/login"],
		["team", "/"],
	])("rejects %s before any database or fix-store read", async (_, destination) => {
		vi.mocked(requireAdmin).mockImplementationOnce(async () => redirect(destination))
		await expect(getLivePhones("season")).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") })
		expect(loadLivePhones).not.toHaveBeenCalled()
	})

	it.each<LivePhones>([
		{ live: false },
		{
			live: true,
			mapArea: null,
			teams: [{ id: "team", name: "Players" }],
			phones: [{ id: "record", teamId: "team", name: "Fox", lat: 55, lng: 13, accuracy: 10, expiresInMs: 30_000 }],
		},
	])("returns admin payload %j", async (payload) => {
		vi.mocked(loadLivePhones).mockResolvedValue(payload)
		expect(await getLivePhones("season")).toEqual(payload)
		expect(loadLivePhones).toHaveBeenCalledExactlyOnceWith("season")
		expect(vi.mocked(requireAdmin).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(loadLivePhones).mock.invocationCallOrder[0] as number,
		)
	})
})
