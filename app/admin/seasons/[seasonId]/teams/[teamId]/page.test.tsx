import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { DeleteTeamButton } from "@/components/admin/delete-team-button"
import { ResetPassword } from "@/components/admin/reset-password"
import { TeamHeader } from "@/components/admin/team-header"
import { TeamHistory } from "@/components/admin/team-history"
import { TeamPhones } from "@/components/admin/team-phones"
import { TeamPreview } from "@/components/admin/team-preview"
import { requireAdmin } from "@/lib/auth/guards"
import { listTeamPhones } from "@/lib/db/phones"
import { getSeason } from "@/lib/db/seasons"
import { listSeasonTeams } from "@/lib/db/teams"
import { buildFixture } from "@/scripts/fixture"
import TeamPage from "./page"

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/db/seasons", () => ({ getSeason: vi.fn() }))
vi.mock("@/lib/db/phones", () => ({ listTeamPhones: vi.fn() }))
vi.mock("@/lib/db/teams", () => ({ listSeasonTeams: vi.fn() }))
vi.mock("@/app/admin/team-actions", () => ({
	createTeamAction: vi.fn(),
	deleteTeamAction: vi.fn(),
	resetTeamPasswordAction: vi.fn(),
}))

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
	vi.mocked(listTeamPhones).mockResolvedValue([])
	vi.mocked(listSeasonTeams).mockResolvedValue(teams)
})
afterEach(() => vi.useRealTimers())

it("guards before reading season or team data", async () => {
	vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("Unauthorized"))
	await expect(TeamPage(props)).rejects.toThrow("Unauthorized")
	expect(getSeason).not.toHaveBeenCalled()
	expect(listTeamPhones).not.toHaveBeenCalled()
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

it("composes header, safe history, reset, delete control and phone-only preview in reading order", async () => {
	const page = await TeamPage(props)
	const [header, summary, reset, footer, preview] = page.props.children
	const phones = summary.props.children
	expect(header.type).toBe(TeamHeader)
	expect(header.props).toEqual({ seasonId: season._id, name: "Ninjas" })
	expect(summary.type).toBe(TeamHistory)
	expect(summary.props.season).toEqual(season)
	expect(summary.props.team).toEqual(team)
	expect(summary.props.now).toBe(now.getTime())
	expect(phones.type).toBe(TeamPhones)
	expect(phones.props).toEqual({ phones: [], now })
	expect(listTeamPhones).toHaveBeenCalledWith(team._id)
	expect(reset.type).toBe(ResetPassword)
	expect(reset.key).toBe(team._id)
	expect(reset.props).toEqual({ seasonId: season._id, teamId: team._id })
	expect(footer.props.className).toContain("border-t")
	expect(footer.props.children.type).toBe(DeleteTeamButton)
	expect(footer.props.children.props).toEqual({ seasonId: season._id, teamId: team._id, name: "Ninjas" })
	expect(preview.props.className).toContain("lg:hidden")
	expect(preview.props.children.type).toBe(TeamPreview)
	expect(preview.props.children.props).toEqual({ season, team, teams, now: now.getTime() })
	expect(JSON.stringify(page)).not.toContain("passwordHash")
})
