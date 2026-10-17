import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { SeasonTree } from "@/components/admin/season-tree"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason } from "@/lib/db/seasons"
import { listSeasonTeams } from "@/lib/db/teams"
import { questLiveStats } from "@/lib/domain/quest-stats"
import { buildFixture } from "@/scripts/fixture"
import SeasonPage from "./page"

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/db/seasons", () => ({ getSeason: vi.fn() }))
vi.mock("@/lib/db/teams", () => ({ listSeasonTeams: vi.fn() }))

const now = new Date("2026-10-12T17:00:00Z")
const fixture = buildFixture(now)
const props = { params: Promise.resolve({ seasonId: fixture.season._id }), searchParams: Promise.resolve({}) }

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(Date, "now").mockReturnValue(now.getTime())
	vi.mocked(getSeason).mockResolvedValue(fixture.season)
	vi.mocked(listSeasonTeams).mockResolvedValue(fixture.teams)
})

afterEach(() => vi.restoreAllMocks())

it("passes live aggregates and authored hints, never team documents, to the page tree", async () => {
	const page = await SeasonPage(props)
	const tree = page.props.children[0].props.children
	expect(requireAdmin).toHaveBeenCalledOnce()
	expect(tree.type).toBe(SeasonTree)
	expect(tree.props.variant).toBe("page")
	expect(tree.props.now).toBe(now.getTime())
	expect(listSeasonTeams).toHaveBeenCalledExactlyOnceWith(fixture.season._id)
	const expected = questLiveStats(fixture.season, fixture.teams)
	for (const arc of fixture.season.arcs) {
		for (const quest of arc.quests) {
			expect(tree.props.stats[quest.id]).toEqual({ ...expected[quest.id], hints: quest.hints })
		}
	}
	expect(JSON.stringify(tree.props)).not.toContain("passwordHash")
})

it.each(["upcoming", "unscheduled", "ended"])("skips stats and the team query while %s", async (status) => {
	vi.mocked(getSeason).mockResolvedValue({
		...fixture.season,
		start: status === "unscheduled" ? null : new Date(now.getTime() + (status === "upcoming" ? 60_000 : -60_000)),
		end: status === "ended" ? now : null,
	})
	const page = await SeasonPage(props)
	expect(page.props.children[0].props.children.props.stats).toBeUndefined()
	expect(listSeasonTeams).not.toHaveBeenCalled()
})
