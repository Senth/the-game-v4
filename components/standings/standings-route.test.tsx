import { afterEach, describe, expect, it, vi } from "vitest"
import { getStandings } from "@/app/standings/actions"
import Standings from "@/app/standings/page"
import { requireTeam } from "@/lib/auth/guards"
import { playerStandings } from "@/lib/domain/player-game"
import { loadStandings } from "@/lib/game/game"
import { buildFixture } from "@/scripts/fixture"
import { StandingsScreen } from "./standings-screen"

vi.mock("@/lib/auth/guards", () => ({ requireTeam: vi.fn() }))
vi.mock("@/lib/game/game", () => ({ loadStandings: vi.fn() }))
vi.mock("next/navigation", () => ({
	redirect: vi.fn(() => {
		throw new Error("Redirect /")
	}),
}))

const now = new Date("2026-10-10T18:00:00Z")
const fixture = buildFixture(now)
const team = {
	...(fixture.teams.find((candidate) => candidate._id === "team-ninjas") as (typeof fixture.teams)[number]),
	passwordHash: "x",
}
const standings = playerStandings(fixture.season, team, fixture.teams, now)

afterEach(() => vi.clearAllMocks())

describe("standings route and action", () => {
	it("guards the route, loads standings and passes only authorized team and season channels", async () => {
		vi.mocked(requireTeam).mockResolvedValue(team)
		vi.mocked(loadStandings).mockResolvedValue(standings)
		const page = await Standings()
		expect(requireTeam).toHaveBeenCalledOnce()
		expect(loadStandings).toHaveBeenCalledWith(team)
		expect(page.type).toBe(StandingsScreen)
		expect(page.props.initial).toBe(standings)
		expect(page.props.channels).toEqual([`team:${team._id}`, `season:${fixture.season._id}`])
		expect(page.props).not.toHaveProperty("team")
	})

	it("guards every live action before loading standings", async () => {
		vi.mocked(requireTeam).mockResolvedValue(team)
		vi.mocked(loadStandings).mockResolvedValue(standings)
		expect(await getStandings()).toBe(standings)
		expect(requireTeam).toHaveBeenCalledOnce()
		expect(loadStandings).toHaveBeenCalledWith(team)
		expect(vi.mocked(requireTeam).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(loadStandings).mock.invocationCallOrder[0] as number,
		)
	})

	it.each([Standings, getStandings])("does not load data when the guard rejects for %s", async (entry) => {
		vi.mocked(requireTeam).mockRejectedValue(new Error("Denied"))
		await expect(entry()).rejects.toThrow("Denied")
		expect(loadStandings).not.toHaveBeenCalled()
	})

	it.each(["waiting", "countdown"] as const)("redirects %s standings to home", async (lifecycleState) => {
		vi.mocked(requireTeam).mockResolvedValue(team)
		vi.mocked(loadStandings).mockResolvedValue({ lifecycleState })
		await expect(Standings()).rejects.toThrow("Redirect /")
	})
})
