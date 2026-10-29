import { useSelectedLayoutSegment } from "next/navigation"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it, vi } from "vitest"
import { SeasonMenuLinks, SeasonTabs } from "./season-tabs"

vi.mock("next/navigation", () => ({ useSelectedLayoutSegment: vi.fn() }))

it.each([
	[null, "Quests"],
	["teams", "Teams"],
	["map", "Map"],
	["settings", "Settings"],
] as const)("marks only %s as the active phone section", (segment, title) => {
	vi.mocked(useSelectedLayoutSegment).mockReturnValue(segment)
	const html = renderToStaticMarkup(<SeasonTabs seasonId="s1" />)
	const links = html.match(/<a\b[^>]*>.*?<\/a>/g) ?? []
	expect(links).toHaveLength(4)
	const active = links.filter((link) => link.includes('aria-current="page"'))
	expect(active).toHaveLength(1)
	expect(active[0]).toContain(`${title}</a>`)
	expect(active[0]).toContain("border-accent text-head")
	expect(html).toContain('href="/admin/seasons/s1"')
	expect(html).toContain('href="/admin/seasons/s1/teams"')
	expect(html).toContain('href="/admin/seasons/s1/map"')
	expect(html).toContain('href="/admin/seasons/s1/settings"')
	expect(html).toContain("min-h-11")
})

it.each([null, "teams", "map", "settings"])(
	"marks the expanded menu's %s entry active and shows real team count",
	(segment) => {
		vi.mocked(useSelectedLayoutSegment).mockReturnValue(segment)
		const html = renderToStaticMarkup(<SeasonMenuLinks seasonId="s1" teamCount={12} />)
		const links = html.match(/<a\b[^>]*>.*?<\/a>/g) ?? []
		expect(links).toHaveLength(3)
		expect(links[0]).toContain('href="/admin/seasons/s1/settings"')
		expect(links[1]).toContain('href="/admin/seasons/s1/teams"')
		expect(links[1]).toContain("<span>12</span>")
		expect(links[2]).toContain('href="/admin/seasons/s1/map"')
		expect(links[2]).toContain(">Map</a>")
		const active = links.filter((link) => link.includes('aria-current="page"'))
		expect(active).toHaveLength(segment ? 1 : 0)
		if (segment) expect(active[0]).toContain(`href="/admin/seasons/s1/${segment}"`)
	},
)

it("renders zero teams rather than hiding the count", () => {
	vi.mocked(useSelectedLayoutSegment).mockReturnValue(null)
	expect(renderToStaticMarkup(<SeasonMenuLinks seasonId="s1" teamCount={0} />)).toContain("<span>0</span>")
})
