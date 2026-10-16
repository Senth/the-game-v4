import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getGame } from "@/app/actions"
import Home, { viewport } from "@/app/page"
import { TeamQr } from "@/components/team-qr"
import { requireTeam } from "@/lib/auth/guards"
import { type PlayerGame, playerGame } from "@/lib/domain/player-game"
import { buildFixture } from "@/scripts/fixture"
import { withSecrets } from "@/test/secrets"
import { GameScreen } from "./game-screen"

const hooks = vi.hoisted(() => ({ live: false, effects: [] as EffectCallback[], state: null as PlayerGame | null }))

vi.mock("react", async (importOriginal) => {
	const react = await importOriginal<typeof import("react")>()
	return {
		...react,
		useEffect: (effect: EffectCallback, dependencies: unknown[]) => {
			react.useEffect(effect, dependencies)
			if (hooks.live) hooks.effects.push(effect)
		},
		useEffectEvent: (callback: unknown) => callback,
		useState: (initial: unknown) => {
			const [value, setter] = react.useState(initial)
			if (hooks.live && value && typeof value === "object" && "lifecycleState" in value)
				return [
					hooks.state ?? value,
					(next: PlayerGame) => {
						hooks.state = next
					},
				]
			return [value, setter]
		},
	}
})

vi.mock("@/app/actions", () => ({ getGame: vi.fn(), submitAnswer: vi.fn(), revealHint: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/lib/auth/guards", () => ({ requireTeam: vi.fn() }))
vi.mock("@/components/team-qr", () => ({ TeamQr: () => <div>Test /join/token</div> }))

const now = new Date("2026-10-10T18:00:00Z")
const fixture = buildFixture(now)
const team = fixture.teams.find((candidate) => candidate._id === "team-ninjas") as (typeof fixture.teams)[number]
const game = playerGame(withSecrets(fixture.season), team, fixture.teams, now)
const props = {
	initial: game,
	channels: [`team:${team._id}`, `season:${fixture.season._id}`],
	initialNow: now.getTime(),
}

afterEach(() => {
	vi.useRealTimers()
	vi.clearAllMocks()
	hooks.live = false
	hooks.state = null
	hooks.effects.length = 0
	vi.unstubAllGlobals()
})

describe("GameScreen", () => {
	it("renders quest, Intel and fixed dock, with enough main padding to clear it", () => {
		const html = renderToStaticMarkup(<GameScreen {...props} />)
		expect(html).toContain("The keeper&#x27;s last log")
		expect(html.indexOf("The keeper&#x27;s last log")).toBeLessThan(html.indexOf('aria-label="Intel"'))
		expect(html.indexOf('aria-label="Intel"')).toBeLessThan(html.indexOf('aria-label="Your answer"'))
		expect(html).toContain("fixed inset-x-0 bottom-0")
		expect(html).toContain("pb-[calc(var(--spacing)*40+env(safe-area-inset-bottom))]")
		expect(html).toContain("max-w-2xl")
		expect(html).not.toContain("Log out")
		expect(html).not.toMatch(/quest \d+ of \d+/i)
		expect(html).not.toContain("secret-answer-")
		expect(html).not.toContain("secret-note-")
		expect(html).not.toContain("secret-internal-")
		expect(html).not.toContain("secret-hint-backwards-log-h2")
		expect(html).not.toContain("secret-hint-backwards-log-h3")
	})

	it("keeps initial clock/pace markup stable across server and hydration times", () => {
		vi.useFakeTimers()
		vi.setSystemTime(now)
		const before = renderToStaticMarkup(<GameScreen {...props} />)
		vi.advanceTimersByTime(2000)
		expect(renderToStaticMarkup(<GameScreen {...props} />)).toBe(before)
	})

	it("replaces running UI with the lifecycle screen and logout", () => {
		const html = renderToStaticMarkup(
			<GameScreen {...props} initial={{ lifecycleState: "completed", score: 99, rank: 3, teamCount: 10 }} />,
		)
		expect(html).toContain("You solved every quest.")
		expect(html).toContain("99p")
		expect(html).toContain("Log out")
		expect(html).not.toContain("<input")
	})

	it("updates completed place after another team's solve through the existing season subscription", async () => {
		hooks.live = true
		const completedTeam = { ...team, completed: true }
		const initial = playerGame(fixture.season, completedTeam, fixture.teams, now)
		const next = playerGame(
			fixture.season,
			completedTeam,
			fixture.teams.map((candidate) =>
				candidate._id === "team-kodknackarna" ? { ...candidate, score: 65 } : candidate,
			),
			now,
		)
		expect(initial).toMatchObject({ lifecycleState: "completed", rank: 7 })
		expect(next).toMatchObject({ lifecycleState: "completed", rank: 8 })
		vi.mocked(getGame).mockResolvedValue(next)
		const source = {
			readyState: 1,
			onopen: null,
			onmessage: null as (() => void) | null,
			onerror: null,
			close: vi.fn(),
		}
		vi.stubGlobal(
			"EventSource",
			vi.fn(function EventSourceMock() {
				return source
			}),
		)
		vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }))
		const render = () => renderToStaticMarkup(<GameScreen {...props} initial={initial} />)
		expect(render()).toContain("7th")
		const cleanups = hooks.effects.map((effect) => effect()).filter((cleanup): cleanup is () => void => !!cleanup)
		try {
			expect(EventSource).toHaveBeenCalledWith(
				`/api/events?channel=season%3A${fixture.season._id}&channel=team%3A${team._id}`,
			)
			source.onmessage?.()
			await vi.waitFor(() => expect(hooks.state).toEqual(next))
			const html = render()
			expect(html).toContain("8th")
			expect(html).not.toContain("7th")
			expect(html).toContain("64p")
			expect(html).toContain('href="/standings"')
		} finally {
			for (const cleanup of cleanups) cleanup()
		}
	})

	it.each([
		{ lifecycleState: "waiting" },
		{ lifecycleState: "countdown", start: new Date(now.getTime() + 272_000) },
		{ lifecycleState: "countdown", start: now },
	] as const)("shows the join slot for $lifecycleState, including starting", (initial) => {
		const html = renderToStaticMarkup(<GameScreen {...props} initial={initial} qr={<div>/join/token</div>} />)
		expect(html).toContain("/join/token")
	})

	it.each([
		game,
		{ lifecycleState: "completed", score: 120, rank: 1, teamCount: 10 },
		{ lifecycleState: "ended", score: 64, rank: 7, teamCount: 10 },
	] as const)("omits join links from $lifecycleState markup even with a QR slot", (initial) => {
		const html = renderToStaticMarkup(<GameScreen {...props} initial={initial} qr={<div>/join/token</div>} />)
		expect(html).not.toContain("/join/")
	})
})

describe("player home route", () => {
	it("guards the team then loads game and passes only authorized channel ids", async () => {
		vi.mocked(requireTeam).mockResolvedValue({ ...team, passwordHash: "x" })
		vi.mocked(getGame).mockResolvedValue(game)
		const page = await Home()
		expect(requireTeam).toHaveBeenCalledOnce()
		expect(getGame).toHaveBeenCalledOnce()
		expect(vi.mocked(requireTeam).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(getGame).mock.invocationCallOrder[0] as number,
		)
		expect(page.type).toBe(GameScreen)
		expect(page.props.channels).toEqual(props.channels)
		expect(page.props).not.toHaveProperty("team")
		expect(page.props.qr).toBeNull()
		expect(viewport).toEqual({ interactiveWidget: "resizes-content" })
	})

	it("does not load game when the guard rejects", async () => {
		vi.mocked(requireTeam).mockRejectedValue(new Error("Denied"))
		await expect(Home()).rejects.toThrow("Denied")
		expect(getGame).not.toHaveBeenCalled()
	})

	it("keeps waiting live with team and season channels, logout and no game controls", async () => {
		vi.mocked(requireTeam).mockResolvedValue({ ...team, passwordHash: "x" })
		vi.mocked(getGame).mockResolvedValue({ lifecycleState: "waiting" })
		const page = await Home()
		expect(page.type).toBe(GameScreen)
		expect(page.props.channels).toEqual(props.channels)
		const html = renderToStaticMarkup(page)
		expect(html).toContain("The game hasn&#x27;t been scheduled yet.")
		expect(html).toContain("Log out")
		expect(html).not.toContain("<input")
		expect(html).toContain("/join/token")
		expect(page.props.qr.type).toBe(TeamQr)
		expect(page.props.qr.props.team._id).toBe(team._id)
	})

	it("keeps seasonless waiting teams live on their own team channel", async () => {
		vi.mocked(requireTeam).mockResolvedValue({ ...team, seasonId: null, passwordHash: "x" })
		vi.mocked(getGame).mockResolvedValue({ lifecycleState: "waiting" })
		const page = await Home()
		expect(page.type).toBe(GameScreen)
		expect(page.props.channels).toEqual([`team:${team._id}`])
	})

	it.each([
		{ lifecycleState: "completed", score: 120, rank: 1, teamCount: 10 },
		{ lifecycleState: "ended", score: 64, rank: 7, teamCount: 10 },
	] as const)("does not create a QR slot for $lifecycleState server responses", async (initial) => {
		vi.mocked(requireTeam).mockResolvedValue({ ...team, passwordHash: "x" })
		vi.mocked(getGame).mockResolvedValue(initial)
		const page = await Home()
		expect(page.props.qr).toBeNull()
		expect(renderToStaticMarkup(page)).not.toContain("/join/")
	})
})
