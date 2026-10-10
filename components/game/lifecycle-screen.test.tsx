import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PlayerGame } from "@/lib/domain/player-game"
import { LifecycleScreen } from "./lifecycle-screen"

const hooks = vi.hoisted(() => ({ mounted: false, effects: [] as EffectCallback[] }))

vi.mock("react", async (importOriginal) => {
	const react = await importOriginal<typeof import("react")>()
	return {
		...react,
		useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
		useState: () => [
			hooks.mounted,
			(mounted: boolean) => {
				hooks.mounted = mounted
			},
		],
	}
})

const now = new Date("2026-10-10T18:00:00Z")
const day = 24 * 60 * 60 * 1000
type LifecycleGame = Exclude<PlayerGame, { lifecycleState: "running" }>

beforeEach(() => {
	hooks.mounted = false
	hooks.effects.length = 0
})

afterEach(() => vi.restoreAllMocks())

describe("LifecycleScreen", () => {
	it.each<[LifecycleGame, string, string | null, boolean]>([
		[{ lifecycleState: "waiting" }, "The game hasn&#x27;t been scheduled yet.", null, true],
		[{ lifecycleState: "countdown", start: new Date(now.getTime() + 272_000) }, "The game starts in", "4:32", true],
		[{ lifecycleState: "countdown", start: now }, "The game is starting…", null, true],
		[{ lifecycleState: "completed", score: 120 }, "You solved every quest.", "120p", false],
		[{ lifecycleState: "ended", score: 64 }, "Time&#x27;s up.", "64p", false],
	])("renders $0.lifecycleState with sentence first, value second and bottom logout", (game, sentence, value, qr) => {
		const html = renderToStaticMarkup(<LifecycleScreen game={game} now={now} qr={<div>Test QR slot</div>} />)
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
		if (qr) expect(html.indexOf(sentence)).toBeLessThan(html.indexOf("Test QR slot"))
		if (game.lifecycleState === "waiting") expect(html).toContain("This page updates by itself.")
	})

	it.each([day, 7 * day])("reserves a blank date slot at %i ms until mount, then uses phone locale", (distance) => {
		const start = new Date(now.getTime() + distance)
		const format = vi.spyOn(Date.prototype, "toLocaleString").mockReturnValue("Phone-local date")
		const render = () =>
			renderToStaticMarkup(<LifecycleScreen game={{ lifecycleState: "countdown", start }} now={now} />)
		const server = render()
		expect(server).toContain("min-h-18")
		expect(server).not.toContain("Phone-local date")
		expect(render()).toBe(server)
		expect(format).not.toHaveBeenCalled()
		for (const effect of hooks.effects) effect()
		expect(render()).toContain("Phone-local date")
		expect(format).toHaveBeenCalledWith(undefined, {
			weekday: "short",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
			...(distance >= 7 * day ? { day: "numeric", month: "short" } : {}),
		})
	})
})
