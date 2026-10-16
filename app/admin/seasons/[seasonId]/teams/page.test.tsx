import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { TeamsList } from "@/components/admin/teams-list"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason } from "@/lib/db/seasons"
import { listSeasonTeams } from "@/lib/db/teams"
import { adminTeamRows } from "@/lib/domain/admin-teams"
import { buildFixture } from "@/scripts/fixture"
import TeamsPage from "./page"

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/db/seasons", () => ({ getSeason: vi.fn() }))
vi.mock("@/lib/db/teams", () => ({ listSeasonTeams: vi.fn() }))
vi.mock("@/app/admin/team-actions", () => ({ createTeamAction: vi.fn() }))

const now = new Date("2026-10-11T17:00:00Z")
const { season, teams } = buildFixture(now)
const storedTeams = teams.map((team) => ({ ...team, passwordHash: "secret-password-hash" }))
const props = { params: Promise.resolve({ seasonId: season._id }), searchParams: Promise.resolve({}) }

beforeEach(() => {
	vi.clearAllMocks()
	vi.useFakeTimers()
	vi.setSystemTime(now)
	vi.mocked(getSeason).mockResolvedValue(season)
	vi.mocked(listSeasonTeams).mockResolvedValue(storedTeams)
})
afterEach(() => vi.useRealTimers())

it("guards before loading any season or team data", async () => {
	vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("Unauthorized"))
	await expect(TeamsPage(props)).rejects.toThrow("Unauthorized")
	expect(getSeason).not.toHaveBeenCalled()
	expect(listSeasonTeams).not.toHaveBeenCalled()
})

it("returns 404 for a missing season without loading teams", async () => {
	vi.mocked(getSeason).mockResolvedValueOnce(null)
	await expect(TeamsPage(props)).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" })
	expect(listSeasonTeams).not.toHaveBeenCalled()
})

it("loads season-scoped teams and passes only derived rows at the current time to the client", async () => {
	const element = await TeamsPage(props)
	expect(getSeason).toHaveBeenCalledWith(season._id)
	expect(listSeasonTeams).toHaveBeenCalledWith(season._id)
	expect(element.type).toBe(TeamsList)
	expect(element.props).toEqual({ seasonId: season._id, rows: adminTeamRows(season, teams, now) })
	expect(element.props.rows).toHaveLength(10)
	expect(JSON.stringify(element.props)).not.toContain("passwordHash")
	expect(JSON.stringify(element.props)).not.toContain("secret-password-hash")
})
