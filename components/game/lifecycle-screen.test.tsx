import type { EffectCallback, ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PlayerGame } from "@/lib/domain/player-game"
import { LifecycleScreen } from "./lifecycle-screen"
import type { SavePhoneName } from "./name-dialog"

const hooks = vi.hoisted(() => ({
	mounted: false,
	effects: [] as EffectCallback[],
	cursor: 0,
	states: [] as unknown[],
}))

vi.mock("react", async (importOriginal) => {
	const react = await importOriginal<typeof import("react")>()
	return {
		...react,
		useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
		useState: (initial: unknown) => {
			const index = hooks.cursor++
			return index === 0
				? [hooks.mounted, (mounted: boolean) => (hooks.mounted = mounted)]
				: [
						hooks.states[index] ?? (typeof initial === "function" ? (initial as () => unknown)() : initial),
						(value: unknown) => (hooks.states[index] = value),
					]
		},
	}
})

const now = new Date("2026-10-10T18:00:00Z")
const day = 24 * 60 * 60 * 1000
type LifecycleGame = Exclude<PlayerGame, { lifecycleState: "running" }>

beforeEach(() => {
	hooks.mounted = false
	hooks.effects.length = 0
	hooks.cursor = 0
	hooks.states = []
})

afterEach(() => vi.restoreAllMocks())

describe("LifecycleScreen", () => {
	it.each(["waiting", "countdown"] as const)(
		"disables %s name edits until a deferred save finishes",
		async (lifecycleState) => {
			const game: LifecycleGame = {
				lifecycleState,
				start: new Date(now.getTime() + 60_000),
				teamName: "Ninjas",
				phones: [{ name: "Quiet Fox", you: true }],
			}
			let finish!: (result: Awaited<ReturnType<SavePhoneName>>) => void
			const savePhoneName = vi.fn<SavePhoneName>(() => new Promise((resolve) => (finish = resolve)))
			const props = { game, now, savePhoneName }
			const screen = LifecycleScreen(props)
			const form = screen.props.children[0].props.children[1].props.children[0]
			const pending = form.props.onSubmit({ preventDefault: vi.fn() })
			const html = () => {
				hooks.cursor = 0
				return renderToStaticMarkup(<LifecycleScreen {...props} />)
			}
			expect(savePhoneName).toHaveBeenCalledWith("Quiet Fox")
			expect(html()).toMatch(/<input[^>]*disabled=""/)
			finish({ phones: [{ name: "Quiet Fox", you: true }] })
			await pending
			expect(html()).not.toMatch(/<input[^>]*disabled=""/)
		},
	)

	function render(
		game: LifecycleGame,
		options: { qr?: ReactNode; preview?: boolean } = {},
		now = new Date("2026-10-10T18:00:00Z"),
	) {
		hooks.cursor = 0
		return renderToStaticMarkup(
			<LifecycleScreen
				game={game}
				now={now}
				qr={options.qr}
				preview={options.preview}
				savePhoneName={options.preview ? undefined : vi.fn(async () => ({ phones: [] }))}
			/>,
		)
	}

	it.each<LifecycleGame>([
		{ lifecycleState: "waiting", teamName: "Ninjas", phones: [{ name: "Quiet Fox", you: true }] },
		{
			lifecycleState: "countdown",
			start: new Date(now.getTime() + 60_000),
			teamName: "Ninjas",
			phones: [{ name: "Quiet Fox", you: true }],
		},
		{ lifecycleState: "completed", teamId: "team", finishers: [], score: 120, rank: 1, teamCount: 10 },
		{ lifecycleState: "ended", teamId: "team", finishers: [], score: 64, rank: 7, teamCount: 10 },
	])("keeps $lifecycleState previews inert even with a QR slot", (game) => {
		const html = render(game, { qr: <div>Test QR slot</div>, preview: true })
		expect(html).not.toContain("Test QR slot")
		expect(html).not.toContain("Log out")
		expect(html).not.toContain("<a")
		expect(html).not.toContain("<footer")
		expect(html).not.toContain("Your name")
		expect(html).not.toContain("On this team")
		expect(html).not.toContain("<input")
	})
	it.each<[LifecycleGame, string, string | null, boolean]>([
		[
			{ lifecycleState: "waiting", teamName: "Ninjas", phones: [{ name: "Quiet Fox", you: true }] },
			"The game hasn&#x27;t been scheduled yet.",
			null,
			true,
		],
		[
			{
				lifecycleState: "countdown",
				start: new Date(now.getTime() + 272_000),
				teamName: "Ninjas",
				phones: [{ name: "Quiet Fox", you: true }],
			},
			"The game starts in",
			"4:32",
			true,
		],
		[
			{ lifecycleState: "countdown", start: now, teamName: "Ninjas", phones: [{ name: "Quiet Fox", you: true }] },
			"The game is starting…",
			null,
			true,
		],
		[
			{ lifecycleState: "completed", teamId: "team", finishers: [], score: 120, rank: 1, teamCount: 10 },
			"You solved every quest.",
			"120p",
			false,
		],
		[
			{ lifecycleState: "ended", teamId: "team", finishers: [], score: 64, rank: 7, teamCount: 10 },
			"Time&#x27;s up.",
			"64p",
			false,
		],
	])("renders $0.lifecycleState with sentence first, value second and bottom logout", (game, sentence, value, qr) => {
		const html = render(game, { qr: <div>Test QR slot</div> })
		expect(html).toContain(sentence)
		expect(html).toContain("font-head text-2xl")
		expect(html).toContain("text-balance")
		expect(html).toContain("max-w-sm")
		expect(html).toContain('<footer class="pb-4 text-center text-sm">')
		expect(html).toContain('action="/logout" method="post"')
		expect(html).toContain("Log out")
		expect(html).not.toContain("The Game")
		if (value) {
			expect(html.indexOf(sentence)).toBeLessThan(html.indexOf(value))
			expect(html).toContain("font-cond text-7xl font-bold text-ink tabular-nums")
		}
		expect(html.includes("Test QR slot")).toBe(qr)
		expect(html.includes('href="/standings"')).toBe(!qr)
		if (qr) expect(html.indexOf(sentence)).toBeLessThan(html.indexOf("Test QR slot"))
		if (game.lifecycleState === "waiting") expect(html).toContain("This page updates by itself.")
	})

	it.each<[LifecycleGame, string]>([
		[
			{ lifecycleState: "waiting", teamName: "Ninjas", phones: [{ name: "Quiet Fox", you: true }] },
			"The game hasn&#x27;t been scheduled yet.",
		],
		[
			{
				lifecycleState: "countdown",
				start: new Date(now.getTime() + 272_000),
				teamName: "Ninjas",
				phones: [
					{ name: "Quiet Fox", you: true },
					{ name: "Ben", you: false },
				],
			},
			"4:32",
		],
	])("shows inline name and team list for %s", (game, firstRead) => {
		const html = render(game, { qr: <div>Test QR slot</div> })
		expect(html).toContain('for="lifecycle-name"')
		expect(html).toContain('value="Quiet Fox"')
		expect(html).toMatch(/<button[^>]*border-z2[^>]*>Save<\/button>/)
		expect(html).toContain("Only Ninjas and the game masters see it.")
		expect(html).toContain("On this team")
		expect(html).toContain("Quiet Fox")
		if (game.lifecycleState === "countdown") expect(html).toContain("Ben")
		expect(html.indexOf(firstRead)).toBeLessThan(html.indexOf("Your name"))
		expect(html.indexOf("Your name")).toBeLessThan(html.indexOf("On this team"))
		expect(html.indexOf("On this team")).toBeLessThan(html.indexOf("Test QR slot"))
	})

	it.each(["completed", "ended"] as const)(
		"renders %s score, place and quiet 44 px standings link in order",
		(lifecycleState) => {
			for (const [rank, place] of [
				[1, "1st"],
				[2, "2nd"],
				[7, "7th"],
			] as const) {
				const html = render({ lifecycleState, teamId: "team", finishers: [], score: 64, rank, teamCount: 10 })
				expect(html).toContain(
					`font-cond text-3xl font-bold text-head">${place} <span class="text-lg font-medium text-muted">of 10</span>`,
				)
				expect(html.indexOf("64p")).toBeLessThan(html.indexOf(place))
				expect(html.indexOf(place)).toBeLessThan(html.indexOf("Standings ›"))
				expect(html).toMatch(/<a[^>]*h-11[^>]*text-link[^>]*href="\/standings"[^>]*>Standings ›<\/a>/)
				expect(html).not.toContain("Tied")
			}
		},
	)

	it.each([day, 7 * day])("reserves a blank date slot at %i ms until mount, then uses phone locale", (distance) => {
		const start = new Date(now.getTime() + distance)
		const format = vi.spyOn(Date.prototype, "toLocaleString").mockReturnValue("Phone-local date")
		const renderCountdown = () =>
			render({
				lifecycleState: "countdown",
				start,
				teamName: "Ninjas",
				phones: [{ name: "Quiet Fox", you: true }],
			})
		const server = renderCountdown()
		expect(server).toContain("min-h-18")
		expect(server).not.toContain("Phone-local date")
		expect(renderCountdown()).toBe(server)
		expect(format).not.toHaveBeenCalled()
		for (const effect of hooks.effects) effect()
		expect(renderCountdown()).toContain("Phone-local date")
		expect(format).toHaveBeenCalledWith(undefined, {
			weekday: "short",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
			...(distance >= 7 * day ? { day: "numeric", month: "short" } : {}),
		})
	})
})
