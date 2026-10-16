import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { teamHistory } from "@/lib/domain/team-history"
import { buildFixture } from "@/scripts/fixture"
import { TeamHistory } from "./team-history"

const now = new Date("2026-10-11T17:00:00Z")
const { season, teams } = buildFixture(now)
const ninjas = teams.find((team) => team.name === "Ninjas")
const lagom = teams.find((team) => team.name === "Lagom")
if (!ninjas || !lagom) throw new Error("Missing history fixture")

it("renders Ninjas score, pace, authored arcs, current quest and snapshot hints without rank or controls", () => {
	const html = renderToStaticMarkup(<TeamHistory history={teamHistory(season, ninjas, now)} />)
	expect(html).toContain("64p")
	expect(html).toContain("5 / 12")
	expect(html).toContain("−11p from hints")
	expect(html).toContain('text-pace-2">2 behind pace')
	expect(html.indexOf("Lighthouse")).toBeLessThan(html.indexOf("Old Town"))
	expect(html.indexOf("Old Town")).toBeLessThan(html.indexOf("Finale"))
	const current = html.match(/<li[^>]*>.*?Backwards log.*?<\/li>/)?.[0]
	expect(current).toContain('aria-label="Current"')
	expect(current).toContain("bg-accent/10")
	expect(current).toContain("Now")
	expect(current).toContain("Start from the bottom.")
	expect(current).toContain("H1")
	expect(html).toContain('aria-label="Solved"')
	expect(html).toContain('aria-label="Not reached"')
	expect(html).toContain("+17p")
	expect(html).not.toMatch(/Rank|<table|<button|<input|<a |Removed during play/)
})

it.each([
	[null, false, "Not started", "text-muted"],
	[new Date(now.getTime() + 1000), false, "Not started", "text-muted"],
	[season.start, false, "Game ended", "text-muted"],
	[season.start, true, "Finished", "text-pace-ok"],
] as const)("renders lifecycle state %s %s as %s", (start, completed, label, color) => {
	const history = teamHistory({ ...season, start, end: now }, { ...ninjas, completed }, now)
	const html = renderToStaticMarkup(<TeamHistory history={history} />)
	expect(html).toContain(`${color}">${label}`)
	expect(html).not.toContain(">Now<")
	expect(html).not.toContain("bg-accent/10")
	if (label === "Game ended") {
		expect(html).toContain('aria-label="Stopped"')
		expect(html).toContain("border-2 border-muted")
		expect(html).toContain(">Stopped<")
		expect(html).toContain("Start from the bottom.")
	}
})

it("keeps removed and deleted hint snapshots, with solved and skipped removed rows", () => {
	const history = teamHistory(season, lagom, now)
	history.removed.push({ questId: "removed-solved", solved: true, pointsEarned: 12, hints: [] })
	const html = renderToStaticMarkup(<TeamHistory history={history} />)
	expect(html.indexOf("Removed during play")).toBeGreaterThan(html.indexOf("Finale"))
	expect(html.match(/Removed quest/g)).toHaveLength(2)
	expect(html).toContain('aria-label="Skipped"')
	expect(html).toContain("×")
	expect(html).toContain("Skipped · 0p")
	expect(html).toContain("+12p")
	expect(html).toContain("H?")
	for (const hint of [
		...history.removed.flatMap((quest) => quest.hints),
		...history.arcs.flatMap((arc) => arc.quests.flatMap((quest) => quest.hints)),
	]) {
		expect(html).toContain(hint.text)
		expect(html).toContain(`−${hint.points}p`)
	}
})

it("keeps 200-character hint text in one truncated grid cell with fixed label and penalty", () => {
	const history = teamHistory(season, ninjas, now)
	const text = "W".repeat(200)
	const quest = history.arcs[0]?.quests[0]
	if (!quest) throw new Error("Missing history quest")
	quest.hints = [{ label: "H1", text, points: 5 }]
	const html = renderToStaticMarkup(<TeamHistory history={history} />)
	expect(html).toContain("grid-cols-[1rem_minmax(0,1fr)_auto]")
	expect(html).toContain("flex gap-2 text-xs leading-5 min-w-0")
	expect(html).toContain('shrink-0">H1</span>')
	expect(html).toContain(`class="text-ink/80 truncate">${text}</span>`)
	expect(html).not.toMatch(/flex-wrap|break-words|whitespace-normal|<br/)
})

it("quiets zero hint loss and untitled drafts", () => {
	const history = teamHistory(season, { ...ninjas, progress: [] }, now)
	const quest = history.arcs[0]?.quests[0]
	if (!quest) throw new Error("Missing history quest")
	quest.label = null
	const html = renderToStaticMarkup(<TeamHistory history={history} />)
	expect(html).toContain('text-muted">No hints')
	expect(html).toContain("Untitled quest")
	expect(html).not.toContain("−0p from hints")
})
