import { renderToStaticMarkup } from "react-dom/server"
import { expect, it, vi } from "vitest"
import { buildFixture } from "@/scripts/fixture"
import { SeasonMenu } from "./season-menu"

vi.mock("@/app/admin/actions", () => ({ createSeasonAction: vi.fn() }))

const now = new Date("2026-10-11T17:00:00Z")
const live = buildFixture(now).season
const upcoming = { ...live, _id: "next", title: "Next hunt", start: new Date("2026-10-31T17:00:00Z"), end: null }
const draft = { ...live, _id: "draft", title: "Draft hunt", start: null, end: null }
const past = {
	...live,
	_id: "past",
	title: "Past hunt",
	start: new Date("2025-10-11T17:00:00Z"),
	end: new Date("2025-10-11T18:00:00Z"),
}

it("renders grouped collapsed roots with quiet short metadata", () => {
	const html = renderToStaticMarkup(<SeasonMenu seasons={[past, draft, upcoming, live]} now={now.getTime()} />)
	const [current, history] = html.split("Past</h2>")
	expect(current).toContain("+ New season")
	expect(current?.indexOf(live.title)).toBeLessThan(current?.indexOf(upcoming.title) ?? 0)
	expect(current?.indexOf(upcoming.title)).toBeLessThan(current?.indexOf(draft.title) ?? 0)
	expect(current).toContain("Live")
	expect(current).toContain("bg-pace-ok")
	expect(current).toContain("31 Oct")
	expect(current).toContain("Not started")
	expect(current).toContain("▸")
	expect(current).not.toContain("▾")
	expect(html).not.toContain("aria-current")
	expect(history).toContain("Oct 2025")
	expect(history).toContain("text-muted")
	expect(history).not.toMatch(/Live|Ended|bg-z2|pace-ok/)
	expect(html).toContain(`href="/admin/seasons/${live._id}"`)
})

it("expands children only beneath the open season", () => {
	const html = renderToStaticMarkup(
		<SeasonMenu seasons={[live, upcoming]} now={now.getTime()} openSeasonId={live._id}>
			<p>Expanded season</p>
		</SeasonMenu>,
	)
	expect(html).toContain('aria-current="page"')
	expect(html).toContain("▾")
	expect(html.split("Expanded season")).toHaveLength(2)
	expect(html.indexOf("Expanded season")).toBeGreaterThan(html.indexOf(live.title))
	expect(html.indexOf("Expanded season")).toBeLessThan(html.indexOf(upcoming.title))
})

it("keeps create available in the empty state", () => {
	const html = renderToStaticMarkup(<SeasonMenu seasons={[]} now={now.getTime()} />)
	expect(html).toContain("+ New season")
	expect(html).toContain("No seasons yet.")
	expect(html).not.toContain("<section")
})
