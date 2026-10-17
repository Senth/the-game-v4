import { useSelectedLayoutSegments } from "next/navigation"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { buildFixture } from "@/scripts/fixture"
import { SeasonPreview } from "./season-preview"

vi.mock("next/navigation", () => ({ useSelectedLayoutSegments: vi.fn() }))
vi.mock("./use-season-clock", () => ({ useSeasonClock: (now: number) => now }))

const now = Date.parse("2026-10-15T18:00:00Z")
const { season, teams } = buildFixture(new Date(now))

beforeEach(() => vi.mocked(useSelectedLayoutSegments).mockReturnValue([]))

it("selects the team preview on its detail route", () => {
	vi.mocked(useSelectedLayoutSegments).mockReturnValue(["teams", "team-ninjas"])
	const html = renderToStaticMarkup(<SeasonPreview season={season} teams={teams} now={now} />)
	expect(html).toContain("What Ninjas see now")
	expect(html).toContain("Start from the bottom.")
	expect(html).not.toContain("Open a quest or team to preview it.")
})

it.each([["teams"], ["teams", "missing-team"], ["settings"]])("keeps the placeholder on %j", (...segments) => {
	vi.mocked(useSelectedLayoutSegments).mockReturnValue(segments)
	const html = renderToStaticMarkup(<SeasonPreview season={season} teams={teams} now={now} />)
	expect(html).toContain("Player preview")
	expect(html).toContain("Open a quest or team to preview it.")
})
