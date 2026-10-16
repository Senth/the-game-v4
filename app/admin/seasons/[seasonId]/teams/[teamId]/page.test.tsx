import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { DeleteTeamButton } from "@/components/admin/delete-team-button"
import { TeamHeader } from "@/components/admin/team-header"
import { TeamRow } from "@/components/admin/teams-list"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason } from "@/lib/db/seasons"
import { listSeasonTeams } from "@/lib/db/teams"
import { adminTeamRows } from "@/lib/domain/admin-teams"
import { buildFixture } from "@/scripts/fixture"
import TeamPage from "./page"

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/db/seasons", () => ({ getSeason: vi.fn() }))
vi.mock("@/lib/db/teams", () => ({ listSeasonTeams: vi.fn() }))
vi.mock("@/app/admin/team-actions", () => ({ createTeamAction: vi.fn(), deleteTeamAction: vi.fn() }))

const now = new Date("2026-10-11T17:00:00Z")
const { season, teams } = buildFixture(now)
const team = teams.find((team) => team.name === "Ninjas")
if (!team) throw new Error("Missing Ninjas fixture")
const props = { params: Promise.resolve({ seasonId: season._id, teamId: team._id }), searchParams: Promise.resolve({}) }

beforeEach(() => {
	vi.clearAllMocks()
	vi.useFakeTimers()
	vi.setSystemTime(now)
	vi.mocked(getSeason).mockResolvedValue(season)
	vi.mocked(listSeasonTeams).mockResolvedValue(teams.map((team) => ({ ...team, passwordHash: "secret-password-hash" })))
})
afterEach(() => vi.useRealTimers())

it("guards before reading season or team data", async () => {
	vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("Unauthorized"))
	await expect(TeamPage(props)).rejects.toThrow("Unauthorized")
	expect(getSeason).not.toHaveBeenCalled()
	expect(listSeasonTeams).not.toHaveBeenCalled()
})

it.each(["missing", "deleted"])("redirects %s team to season teams list", async (kind) => {
	vi.mocked(listSeasonTeams).mockResolvedValueOnce(kind === "deleted" ? [] : teams)
	const params = Promise.resolve({ seasonId: season._id, teamId: kind === "deleted" ? team._id : kind })
	await expect(TeamPage({ ...props, params })).rejects.toMatchObject({
		digest: `NEXT_REDIRECT;replace;/admin/seasons/${season._id}/teams;307;`,
	})
	expect(listSeasonTeams).toHaveBeenCalledWith(season._id)
})

it("redirects a real team opened under another season", async () => {
	vi.mocked(getSeason).mockResolvedValueOnce({ ...season, _id: "other-season" })
	vi.mocked(listSeasonTeams).mockResolvedValueOnce([])
	await expect(
		TeamPage({ ...props, params: Promise.resolve({ seasonId: "other-season", teamId: team._id }) }),
	).rejects.toMatchObject({
		digest: "NEXT_REDIRECT;replace;/admin/seasons/other-season/teams;307;",
	})
	expect(listSeasonTeams).toHaveBeenCalledWith("other-season")
})

it("redirects missing season without reading teams", async () => {
	vi.mocked(getSeason).mockResolvedValueOnce(null)
	await expect(TeamPage(props)).rejects.toMatchObject({
		digest: `NEXT_REDIRECT;replace;/admin/seasons/${season._id}/teams;307;`,
	})
	expect(listSeasonTeams).not.toHaveBeenCalled()
})

it("composes phone header, ranked safe summary and separated delete control", async () => {
	const page = await TeamPage(props)
	const [header, summary, footer] = page.props.children
	expect(header.type).toBe(TeamHeader)
	expect(header.props).toEqual({ seasonId: season._id, name: "Ninjas" })
	expect(summary.type).toBe(TeamRow)
	expect(summary.props).toEqual({
		seasonId: season._id,
		row: adminTeamRows(season, teams, now).find((row) => row.id === team._id),
		summary: true,
	})
	expect(footer.props.className).toContain("border-t")
	expect(footer.props.children.type).toBe(DeleteTeamButton)
	expect(footer.props.children.props).toEqual({ seasonId: season._id, teamId: team._id, name: "Ninjas" })
	expect(JSON.stringify(page)).not.toContain("passwordHash")
})
