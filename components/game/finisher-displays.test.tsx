import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { TeamHistory } from "@/components/admin/team-history"
import { TeamPreview } from "@/components/admin/team-preview"
import { BoardList } from "@/components/board/board-list"
import { StandingsList } from "@/components/standings/standings-list"
import { playerGame, playerStandings } from "@/lib/domain/player-game"
import { buildFixture } from "@/scripts/fixture"
import { LifecycleScreen } from "./lifecycle-screen"
import { StandingsStrip } from "./standings-strip"

const now = new Date("2026-10-20T18:00:00Z")
const fixture = buildFixture(now)
const team = fixture.teams[0]
const end = fixture.season.end
if (!team || !end) throw new Error("Missing finisher fixture")

it.each([0, 50])("flags %i-point finishers in ranking rows, but keeps strip bonus-free", (points) => {
	const season = { ...fixture.season, finishers: [{ teamId: team._id, place: 1, points, at: now }] }
	const game = playerGame(season, team, fixture.teams, now)
	const standings = playerStandings(season, team, fixture.teams, now)
	if (game.lifecycleState !== "running" || !("rows" in standings)) throw new Error("Missing ranking fixture")
	for (const html of [
		renderToStaticMarkup(<StandingsList rows={standings.rows} finishers={standings.finishers} />),
		renderToStaticMarkup(<BoardList rows={standings.rows} finishers={standings.finishers} />),
	]) {
		expect(html).toContain(`aria-label="${points ? "Finished, +50p bonus" : "Finished"}"`)
		expect(html.includes(">+50p</span>")).toBe(points > 0)
		expect(html).not.toContain("+0p")
		expect(html).not.toContain("1st")
	}
	const strip = renderToStaticMarkup(<StandingsStrip strip={game.strip} finishers={game.finishers} />)
	expect(strip).toContain('aria-label="Finished"')
	expect(strip).not.toMatch(/\+\d+p/)
	const preview = renderToStaticMarkup(
		<TeamPreview season={season} team={team} teams={fixture.teams} now={now.getTime()} />,
	)
	expect(preview).toContain('aria-label="Finished"')
	expect(preview).not.toMatch(/\+\d+p/)
})

it.each([
	[1, 50, "First"],
	[2, 20, "2nd"],
	[3, 0, "3rd"],
] as const)("shows positive finish %i bonus below completed score, preserving points rank", (place, points, label) => {
	const season = { ...fixture.season, finishers: [{ teamId: team._id, place, points, at: now }] }
	for (const ended of [false, true]) {
		const game = playerGame(season, { ...team, completed: !ended }, fixture.teams, ended ? end : now)
		if (game.lifecycleState !== "completed" && game.lifecycleState !== "ended") throw new Error(game.lifecycleState)
		const html = renderToStaticMarkup(<LifecycleScreen game={game} now={now} />)
		expect(html.includes(`${label} to finish · +${points}p`)).toBe(points > 0 && !ended)
		expect(html.includes('aria-label="Finished,')).toBe(points > 0 && !ended)
		expect(html).toContain("of 10")
		if (points > 0 && !ended) {
			expect(html.indexOf(`${team.score}p`)).toBeLessThan(html.indexOf(`${label} to finish`))
			expect(html.indexOf(`${label} to finish`)).toBeLessThan(html.indexOf("of 10"))
		}
	}
})

it.each([0, 50])("inserts only positive %i-point M4 bonus between arcs and removed quests", (points) => {
	const season = { ...fixture.season, finishers: [{ teamId: team._id, place: 1, points, at: now }] }
	const completed = {
		...team,
		completed: true,
		progress: [...team.progress, { questId: "removed", pointsEarned: 0, hintsRevealed: [] }],
	}
	const html = renderToStaticMarkup(<TeamHistory season={season} team={completed} now={now.getTime()} />)
	expect(html.includes("Finisher bonus")).toBe(points > 0)
	if (points > 0) {
		expect(html.indexOf("Finale")).toBeLessThan(html.indexOf("Finisher bonus"))
		expect(html.indexOf("Finisher bonus")).toBeLessThan(html.indexOf("Removed during play"))
		expect(html).toContain("Finished 1st")
		expect(html).toContain("text-pace-ok")
		expect(html).toContain("+50p")
	}
})
