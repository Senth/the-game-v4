import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { playerGame } from "@/lib/domain/player-game"
import { buildFixture } from "@/scripts/fixture"
import { TeamPreview } from "./team-preview"
import { usePuzzlePreviewAssets } from "./use-puzzle-preview-assets"
import { useSeasonClock } from "./use-season-clock"

vi.mock("./use-season-clock", () => ({ useSeasonClock: vi.fn() }))
vi.mock("./use-puzzle-preview-assets", () => ({ usePuzzlePreviewAssets: vi.fn() }))
vi.mock("@/app/actions", () => {
	throw new Error("TeamPreview must not import server actions")
})

const now = Date.parse("2026-10-15T18:00:00Z")
const { season, teams } = buildFixture(new Date(now))
const team = teams.find((team) => team.name === "Ninjas")
if (!team) throw new Error("Missing Ninjas fixture")
const props = { season, team, teams, now }

beforeEach(() => {
	vi.mocked(useSeasonClock).mockReturnValue(now)
	vi.mocked(usePuzzlePreviewAssets).mockReturnValue(undefined)
})

it("renders the team's stored puzzle cells and loose pieces through the inert real board", () => {
	const puzzleTeam = teams.find((team) => team.name === "Rävarna")
	if (!puzzleTeam) throw new Error("Missing Rävarna fixture")
	vi.mocked(usePuzzlePreviewAssets).mockReturnValue({
		ids: Array.from({ length: 16 }, (_, index) => `opaque-${index}`),
		aspect: 2,
		fullUrl: "/api/puzzle/gather-pieces/full",
	})
	const html = renderToStaticMarkup(<TeamPreview {...props} team={puzzleTeam} />)
	expect(html).toContain('aria-label="Puzzle board" inert=""')
	expect(html.match(/data-piece=/g)).toHaveLength(16)
	expect(html).toContain("left:0%;top:0%;width:25%;height:25%")
	expect(html).not.toContain('aria-label="Your answer"')
	expect(html).not.toContain("Full picture ›")
})

it("renders the team's real running screen with revealed hints, pace and inert standings", () => {
	const before = JSON.stringify(props)
	const html = renderToStaticMarkup(<TeamPreview {...props} />)
	const game = playerGame(season, team, teams, new Date(now))
	if (game.lifecycleState !== "running") throw new Error("Expected running fixture")
	expect(html).toContain("What Ninjas see now")
	expect(html).toContain(">live</span>")
	expect(html).toContain("h-[700px] w-[327px]")
	expect(html).toContain("h-[844px] w-[390px] origin-top-left scale-[0.82]")
	expect(html).toContain('<div class="h-full overflow-y-auto">')
	expect(html).toMatch(/<main[^>]*><section inert="">/)
	expect(html).toContain("The keeper&#x27;s last log")
	expect(html).toContain("Start from the bottom.")
	expect(html.match(/Hold to decrypt/g)).toHaveLength(2)
	expect(game.pace).not.toBeNull()
	expect(html).toContain(game.pace?.label ?? "")
	expect(html).toContain("Rävarna")
	expect(html).not.toContain('href="/standings"')
	expect(html).not.toContain('type="button"')
	expect(html).toMatch(/<input[^>]*disabled=""/)
	expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send/)
	const current = season.arcs.flatMap((arc) => arc.quests).find((quest) => quest.id === game.quest?.id)
	for (const secret of [
		...(current?.answers ?? []),
		current?.adminNotes,
		current?.internalTitle,
		current?.hints[1]?.text,
	]) {
		if (secret) expect(html).not.toContain(secret)
	}
	expect(JSON.stringify(props)).toBe(before)
})

it.each([
	["waiting", "The game hasn&#x27;t been scheduled yet."],
	["countdown", "The game starts in"],
	["ended", "Time&#x27;s up."],
	["completed", "You solved every quest."],
] as const)("renders %s without logout, QR or navigation", (state, sentence) => {
	const timing =
		state === "waiting" ? { start: null, end: null } : state === "countdown" ? { start: new Date(now + 60_000) } : {}
	vi.mocked(useSeasonClock).mockReturnValue(state === "ended" ? (season.end?.getTime() ?? now) : now)
	const html = renderToStaticMarkup(
		<TeamPreview {...props} season={{ ...season, ...timing }} team={{ ...team, completed: state === "completed" }} />,
	)
	expect(html).toContain(sentence)
	expect(html).not.toContain("Log out")
	expect(html).not.toContain("/join/")
	expect(html).not.toContain("<a")
	expect(html).not.toContain("<input")
	if (state === "ended" || state === "completed") expect(html).toMatch(/<span[^>]*text-link[^>]*>Standings ›<\/span>/)
})

it("uses the ticking clock for countdown, running time and ended transitions", () => {
	const scheduled = { ...season, start: new Date(now + 1000), end: new Date(now + 61_000) }
	const view = () => renderToStaticMarkup(<TeamPreview {...props} season={scheduled} />)
	expect(view()).toContain("The game starts in")
	vi.mocked(useSeasonClock).mockReturnValue(now + 1000)
	expect(view()).toContain("The keeper&#x27;s last log")
	expect(view()).toContain("1:00")
	vi.mocked(useSeasonClock).mockReturnValue(now + 61_000)
	expect(view()).toContain("Time&#x27;s up.")
	expect(useSeasonClock).toHaveBeenCalledWith(now, scheduled.start, scheduled.end)
})
