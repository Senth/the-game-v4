import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { LiveMap } from "@/components/admin/live-map"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason } from "@/lib/db/seasons"
import { buildFixture } from "@/scripts/fixture"
import MapPage from "./page"

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/db/seasons", () => ({ getSeason: vi.fn() }))

const season = buildFixture(new Date("2026-10-11T17:00:00Z")).season
const props = { params: Promise.resolve({ seasonId: season._id }), searchParams: Promise.resolve({}) }

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(requireAdmin).mockResolvedValue({ _id: "admin", name: "admin", passwordHash: "hash" })
	vi.mocked(getSeason).mockResolvedValue(season)
})

afterEach(() => {
	vi.useRealTimers()
})

it("guards before reading season data", async () => {
	vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("Unauthorized"))
	await expect(MapPage(props)).rejects.toThrow("Unauthorized")
	expect(getSeason).not.toHaveBeenCalled()
})

it("returns 404 for a missing season", async () => {
	vi.mocked(getSeason).mockResolvedValueOnce(null)
	await expect(MapPage(props)).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" })
})

it("renders Map heading and live map for the guarded season", async () => {
	vi.mocked(getSeason).mockResolvedValue(season)
	const page = await MapPage(props)
	const [heading, liveMap] = page.props.children
	expect(requireAdmin).toHaveBeenCalledOnce()
	expect(getSeason).toHaveBeenCalledWith(season._id)
	expect(heading.props.children).toBe("Map")
	expect(heading.props.className.split(" ")).toEqual(
		expect.arrayContaining(["hidden", "lg:block", "text-2xl", "text-head"]),
	)
	expect(liveMap.type).toBe(LiveMap)
	expect(liveMap.props).toEqual({ seasonId: season._id })
})

it("resets map state at scheduled start and end without an SSE event", async () => {
	const start = new Date("2026-10-11T18:00:00Z")
	const end = new Date("2026-10-11T18:10:00Z")
	vi.mocked(getSeason).mockResolvedValue({ ...season, start, end })
	vi.useFakeTimers()
	vi.setSystemTime(start.getTime() - 1)
	const upcomingPage = await MapPage(props)
	const upcomingMap = upcomingPage.props.children[1]
	expect(upcomingMap.key).toBe("upcoming")

	vi.setSystemTime(start)
	const livePage = await MapPage(props)
	const liveMap = livePage.props.children[1]
	expect(liveMap.key).toBe("live")

	vi.setSystemTime(end)
	const endedPage = await MapPage(props)
	const endedMap = endedPage.props.children[1]
	expect(endedMap.key).toBe("ended")
})
