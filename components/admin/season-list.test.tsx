import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { formatSeasonStart } from "@/lib/domain/admin-seasons"
import { buildFixture } from "@/scripts/fixture"
import { SeasonList } from "./season-list"

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

it("groups and sorts rows, shows start copy and links the whole row", () => {
	const html = renderToStaticMarkup(<SeasonList seasons={[past, draft, upcoming, live]} now={now.getTime()} />)
	const [current, history] = html.split("Past</h2>")
	expect(current).toContain("Now and next")
	expect(current?.indexOf(live.title)).toBeLessThan(current?.indexOf(upcoming.title) ?? 0)
	expect(current?.indexOf(upcoming.title)).toBeLessThan(current?.indexOf(draft.title) ?? 0)
	expect(current).not.toContain(past.title)
	expect(history).toContain(past.title)
	expect(current).toContain(`Started ${formatSeasonStart(live.start as Date)}`)
	expect(current).toContain(`Starts ${formatSeasonStart(upcoming.start)}`)
	expect(current).toContain("No start time")
	expect(current).toContain("Upcoming")
	expect(current).toContain("Not started")
	expect(html).toContain(`href="/admin/seasons/${live._id}"`)
	expect(html).toContain("min-w-0 flex-1")
	expect(history).toContain(formatSeasonStart(past.start))
	expect(history).not.toMatch(/Started|Starts|Ended|Live|bg-z2|pace-ok/)
	expect(history).toContain("text-muted")
})

it("shows the empty state without empty sections", () => {
	const html = renderToStaticMarkup(<SeasonList seasons={[]} now={now.getTime()} />)
	expect(html).toContain("No seasons yet.")
	expect(html).not.toContain("<section")
})

it("omits a section with no seasons", () => {
	const html = renderToStaticMarkup(<SeasonList seasons={[past]} now={now.getTime()} />)
	expect(html).not.toContain("Now and next")
	expect(html).toContain("Past</h2>")
})
