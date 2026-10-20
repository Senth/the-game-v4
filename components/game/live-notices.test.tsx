import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { TeamPreview } from "@/components/admin/team-preview"
import { BoardScreen } from "@/components/board/board-screen"
import { playerGame, publicBoard } from "@/lib/domain/player-game"
import { useFinisherNotices } from "@/lib/events/use-finisher-notices"
import { buildFixture } from "@/scripts/fixture"
import { GameScreen } from "./game-screen"

vi.mock("@/app/actions", () => ({ getGame: vi.fn(), submitAnswer: vi.fn(), revealHint: vi.fn() }))
vi.mock("@/app/board/actions", () => ({ getBoard: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/lib/events/use-finisher-notices", () => ({ useFinisherNotices: vi.fn() }))

const now = new Date("2026-10-20T18:00:00Z")
const fixture = buildFixture(now)
const team = fixture.teams.find((entry) => entry._id === "team-ninjas")
if (!team) throw new Error("Missing notice fixture")
const initial = playerGame(fixture.season, team, fixture.teams, now)
const props = { initial, channels: [], initialNow: now.getTime() }
const notice = { teamId: "first", name: "Rävarna", place: 1, points: 50 }
const dismiss = vi.fn()

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(useFinisherNotices).mockReturnValue({ notice, closing: false, dismiss })
})

it("puts bonus ribbon below header and before quest, passing own team to queue", () => {
	const html = renderToStaticMarkup(<GameScreen {...props} />)
	expect(useFinisherNotices).toHaveBeenCalledWith([], fixture.season.start?.toISOString(), team._id)
	expect(html.indexOf("</header>")).toBeLessThan(html.indexOf("Rävarna finished 1st"))
	expect(html.indexOf("Rävarna finished 1st")).toBeLessThan(html.indexOf("<main"))
	expect(html).toContain('aria-live="polite"')
	expect(html).toContain("finish-notice shrink-0")
})

it("uses only strip for zero bonus, leaving quest layout unchanged", () => {
	vi.mocked(useFinisherNotices).mockReturnValue({ notice: { ...notice, place: 3, points: 0 }, closing: false, dismiss })
	const html = renderToStaticMarkup(<GameScreen {...props} />)
	expect(html.indexOf("Rävarna finished 3rd")).toBeLessThan(html.indexOf("</header>"))
	expect(html).not.toContain("finish-notice shrink-0")
	expect(html).not.toContain("No bonus left")
})

it("keeps notices off completed screen and admin team preview", () => {
	const completed = playerGame(fixture.season, { ...team, completed: true }, fixture.teams, now)
	for (const html of [
		renderToStaticMarkup(<GameScreen {...props} initial={completed} />),
		renderToStaticMarkup(<TeamPreview season={fixture.season} team={team} teams={fixture.teams} now={now.getTime()} />),
	])
		expect(html).not.toContain("Rävarna finished 1st")
	expect(useFinisherNotices).toHaveBeenCalledOnce()
	expect(useFinisherNotices).toHaveBeenCalledWith(undefined, "", team._id)
})

it.each([50, 0])("reserves %i-point board notice space between title and capped rows, above footer", (points) => {
	vi.mocked(useFinisherNotices).mockReturnValue({ notice: { ...notice, points }, closing: false, dismiss })
	const board = publicBoard(
		[fixture.season],
		{ [fixture.season._id]: fixture.teams.map((entry) => ({ ...entry, passwordHash: "test" })) },
		now,
	)
	const html = renderToStaticMarkup(<BoardScreen {...props} initial={board} />)
	expect(useFinisherNotices).toHaveBeenCalledWith([], fixture.season.start?.toISOString())
	expect(html.indexOf("</h1>")).toBeLessThan(html.indexOf("Rävarna finished 1st"))
	expect(html.indexOf("Rävarna finished 1st")).toBeLessThan(html.indexOf("<ol"))
	expect(html.indexOf("</ol>")).toBeLessThan(html.indexOf("bg-time"))
	expect(html).toContain("repeat(10, minmax(0, 76px))")
	expect(html).toContain("grid min-h-0 flex-1")
	expect(html.includes("No bonus left") || html.includes("still open for")).toBe(points > 0)
})
