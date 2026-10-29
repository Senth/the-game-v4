import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getStandings } from "@/app/standings/actions"
import { type PlayerStandings, playerStandings } from "@/lib/domain/player-game"
import { buildFixture } from "@/scripts/fixture"
import { StandingsScreen } from "./standings-screen"
import { TeamPace } from "./team-pace"

const hooks = vi.hoisted(() => ({
	effects: [] as EffectCallback[],
	state: null as PlayerStandings | null,
	now: null as Date | null,
	replace: vi.fn(),
	setState: vi.fn(),
}))

vi.mock("@/app/standings/actions", () => ({ getStandings: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: hooks.replace }) }))
vi.mock("react", async (importOriginal) => {
	const react = await importOriginal<typeof import("react")>()
	return {
		...react,
		useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
		useEffectEvent: (callback: unknown) => callback,
		useTransition: () => [false, (callback: () => void) => callback()],
		useState: (initial: unknown) => {
			const [value, setter] = react.useState(initial)
			if (value instanceof Date)
				return [
					hooks.now ?? value,
					(next: Date) => {
						hooks.now = next
					},
				]
			if (value && typeof value === "object" && "lifecycleState" in value) return [hooks.state ?? value, hooks.setState]
			return [value, setter]
		},
	}
})

const now = new Date("2026-10-10T18:00:00Z")
const fixture = buildFixture(now)
const team = fixture.teams.find((candidate) => candidate._id === "team-ninjas") as (typeof fixture.teams)[number]
const running = playerStandings(fixture.season, team, fixture.teams, now) as Extract<
	PlayerStandings,
	{ lifecycleState: "running" }
>
const props = {
	initial: running,
	initialNow: now.getTime(),
	channels: [`team:${team._id}`, `season:${fixture.season._id}`],
}
let cleanups: (() => void)[] = []
let source = {
	readyState: 1,
	onopen: null as (() => void) | null,
	onmessage: null as (() => void) | null,
	onerror: null as (() => void) | null,
	close: vi.fn(),
}

function render(initial: PlayerStandings = running) {
	return renderToStaticMarkup(<StandingsScreen {...props} initial={initial} />)
}

function mount(initial: PlayerStandings = running) {
	render(initial)
	cleanups = hooks.effects.map((effect) => effect()).filter((cleanup): cleanup is () => void => !!cleanup)
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(now)
	vi.clearAllMocks()
	hooks.effects.length = 0
	hooks.state = null
	hooks.now = null
	hooks.setState.mockImplementation((next: PlayerStandings) => {
		hooks.state = next
	})
	source = { readyState: 1, onopen: null, onmessage: null, onerror: null, close: vi.fn() }
	vi.stubGlobal(
		"EventSource",
		vi.fn(function EventSourceMock() {
			return source
		}),
	)
	vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }))
})

afterEach(() => {
	for (const cleanup of cleanups) cleanup()
	cleanups = []
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe("StandingsScreen", () => {
	it("renders running S1 with a 44 px quest link, ten compact rows and only your current segment", () => {
		const html = render()
		expect(html).toMatch(/<a[^>]*h-11[^>]*href="\/"[^>]*>‹ Quest<\/a>/)
		expect(html).toContain("max-w-2xl")
		expect(html).toContain("bg-time")
		expect(html.match(/<li /g)).toHaveLength(10)
		expect(html.match(/bg-accent\/15/g)).toHaveLength(1)
		expect(html.match(/aria-current="step"/g)).toHaveLength(1)
		const rows = html.match(/<li .*?<\/li>/g) ?? []
		for (const row of rows) {
			if (row.includes(">Ninjas<")) expect(row).toContain("font-bold")
			else {
				expect(row).not.toContain("bg-accent/15")
				expect(row).not.toContain("current quest")
			}
			expect(row).toContain("h-1.5")
		}
		expect(html).not.toContain("<button")
		expect(html).not.toMatch(/quest \d+ of \d+/i)
	})

	it("keeps long names truncated inside a shrinkable flex child", () => {
		const name = "VeryLongTeamName".repeat(10)
		const html = render({ ...running, rows: running.rows.map((row) => ({ ...row, name })) })
		expect(html).toContain(
			`<span class="min-w-0 flex-1"><span class="flex items-center gap-1"><span class="truncate text-ink`,
		)
		expect(html).toContain(name)
	})

	it.each(["completed", "ended"] as const)(
		"renders %s A1 summary and back link without running bars or current rails",
		(state) => {
			const standings = playerStandings(
				fixture.season,
				{ ...team, completed: state === "completed" },
				fixture.teams,
				state === "ended" ? new Date(fixture.season.end as Date) : now,
			)
			const html = render(standings)
			expect(html).toContain("‹ Back</a>")
			expect(html).toContain(state === "completed" ? "You solved every quest." : "Time&#x27;s up.")
			expect(html).toContain("7th of 10 · 5 / 14 quests")
			expect(html).toContain('text-2xl font-bold text-head">64p')
			expect(html).not.toContain("bg-time")
			expect(html).not.toContain("aria-current")
		},
	)

	it("anchors one-second elapsed and left ticks to server time and keeps initial markup stable", async () => {
		const before = render()
		vi.setSystemTime(now.getTime() + 3_600_000)
		expect(render()).toBe(before)
		hooks.effects.length = 0
		mount()
		const setSystemTime = now.getTime() + 7_200_000
		vi.setSystemTime(setSystemTime)
		await vi.advanceTimersByTimeAsync(1000)
		expect(hooks.now).toEqual(new Date(now.getTime() + 1000))
		const html = render()
		expect(html).toContain("1:12:31")
		expect(html).toContain("47:29")
	})

	it("subscribes to team and season events and updates rows and bars within one second of a teammate solve", async () => {
		const questId = team.questOrder[team.questIndex] as string
		const solvedTeam = {
			...team,
			score: team.score + 10,
			questIndex: team.questIndex + 1,
			progress: [
				...team.progress.filter((entry) => entry.questId !== questId),
				{ questId, solvedAt: now, hintsRevealed: [], pointsEarned: 10 },
			],
		}
		const next = playerStandings(
			fixture.season,
			solvedTeam,
			fixture.teams.map((candidate) => (candidate._id === team._id ? solvedTeam : candidate)),
			now,
		)
		vi.mocked(getStandings).mockResolvedValue(next)
		mount()
		expect(EventSource).toHaveBeenCalledWith(
			`/api/events?channel=season%3A${fixture.season._id}&channel=team%3A${team._id}`,
		)
		source.onmessage?.()
		await vi.advanceTimersByTimeAsync(0)
		expect(hooks.state).toEqual(next)
		const html = render()
		expect(html).toContain("6 / 14")
		expect(html).toContain("6/14")
		expect(html).toContain("74p")
		expect(html).toContain('style="width:42.857142857142854%"')
	})

	it("refreshes at the end boundary and switches to final standings without an event", async () => {
		const initial = { ...running, end: new Date(now.getTime() + 1000) }
		const ended = playerStandings({ ...fixture.season, end: initial.end }, team, fixture.teams, initial.end)
		vi.mocked(getStandings).mockResolvedValue(ended)
		mount(initial)
		await vi.advanceTimersByTimeAsync(999)
		expect(getStandings).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		expect(getStandings).toHaveBeenCalledOnce()
		expect(render()).toContain("Time&#x27;s up.")
		expect(render()).toContain("‹ Back</a>")
	})

	it.each(["waiting", "countdown"] as const)("replaces the route when live standings become %s", (lifecycleState) => {
		hooks.state = { lifecycleState }
		mount()
		expect(hooks.replace).toHaveBeenCalledWith("/")
		expect(render()).toBe("")
	})
})

describe("TeamPace", () => {
	it.each([
		[5, 0, "On pace", "pace-ok"],
		[6, 0, "10% ahead", "pace-ok"],
		[5, 1, "1% behind", "pace-1"],
		[4, 1, "11% behind", "pace-2"],
		[2, 1, "31% behind", "pace-3"],
	] as const)(
		"renders percent text and bar color for %s solved and %s extra milliseconds",
		(solved, extra, label, band) => {
			const standings = {
				...running,
				start: new Date(now.getTime() - 5000),
				end: new Date(now.getTime() + 5000),
				you: { ...running.you, solved, total: 10 },
			}
			const html = renderToStaticMarkup(<TeamPace standings={standings} now={new Date(now.getTime() + extra)} />)
			expect(html).toContain(label)
			expect(html).toContain(`text-${band}`)
			expect(html).toContain(`bg-${band}`)
			expect(html).toContain("w-0.5 bg-ink")
		},
	)

	it.each([{ end: null }, { you: { ...running.you, solved: 0, total: 0 } }])(
		"shows counts without a tick or label when pace is null: %j",
		(patch) => {
			const standings = { ...running, ...patch }
			const html = renderToStaticMarkup(<TeamPace standings={standings} now={now} />)
			expect(html).toContain(`${standings.you.solved} / ${standings.you.total}`)
			expect(html).not.toContain("w-0.5")
			expect(html).not.toContain("behind")
			expect(html).not.toContain("ahead")
			expect(html).not.toContain("On pace")
		},
	)
})
