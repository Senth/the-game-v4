import { beforeEach, expect, it, vi } from "vitest"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason } from "@/lib/db/seasons"
import { buildFixture } from "@/scripts/fixture"
import SettingsPage from "./page"

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/db/seasons", () => ({ getSeason: vi.fn() }))

const season = buildFixture(new Date("2026-10-12T17:00:00Z")).season
const props = { params: Promise.resolve({ seasonId: season._id }), searchParams: Promise.resolve({}) }

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(requireAdmin).mockResolvedValue({ _id: "admin", name: "admin", passwordHash: "hash" })
	vi.mocked(getSeason).mockResolvedValue(season)
})

it("requires admin before reading settings", async () => {
	vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("Unauthorized"))
	await expect(SettingsPage(props)).rejects.toThrow("Unauthorized")
	expect(getSeason).not.toHaveBeenCalled()
})

it("returns 404 for an unknown season", async () => {
	vi.mocked(getSeason).mockResolvedValue(null)
	await expect(SettingsPage(props)).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" })
})

it("passes only settings values and server time across the client boundary", async () => {
	const before = Date.now()
	const element = await SettingsPage(props)
	expect(getSeason).toHaveBeenCalledWith(season._id)
	expect(element.props.season).toEqual({
		_id: season._id,
		title: season.title,
		start: season.start,
		end: season.end,
		lengthMinutes: season.lengthMinutes,
		shuffleArcs: season.shuffleArcs,
		registrationOpen: season.registrationOpen,
	})
	expect(element.props.now).toBeGreaterThanOrEqual(before)
	expect(element.props.now).toBeLessThanOrEqual(Date.now())
	expect(element.props.season).not.toHaveProperty("arcs")
})
