import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { buildFixture } from "@/scripts/fixture"
import { TeamHistory } from "./team-history"

type Clock = { initialNow: number; currentNow: number }
const hooks = vi.hoisted(() => ({ effects: [] as EffectCallback[], clock: null as Clock | null }))
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (initial: Clock) => [
		hooks.clock ?? initial,
		(value: Clock) => {
			hooks.clock = value
		},
	],
	useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
}))

const now = Date.parse("2026-10-11T17:00:00Z")
const { season, teams } = buildFixture(new Date(now))
const team = teams.find((team) => team.name === "Ninjas")
if (!team) throw new Error("Missing Ninjas fixture")
let cleanup: ReturnType<EffectCallback>

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(now + 3_600_000)
	hooks.clock = null
	hooks.effects.length = 0
	vi.stubGlobal("fetch", vi.fn())
})
afterEach(() => {
	cleanup?.()
	cleanup = undefined
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

it("updates idle Ninjas pace text and color from elapsed server time without events or network polling", async () => {
	const props = { season, team, now }
	const view = () => renderToStaticMarkup(<TeamHistory {...props} />)
	expect(view()).toContain('text-pace-3">3 behind pace')
	cleanup = hooks.effects[0]?.()
	vi.setSystemTime(now + 7_200_000)
	await vi.advanceTimersByTimeAsync(10 * 60_000)
	expect(view()).toContain('text-pace-3">5 behind pace')
	await vi.advanceTimersByTimeAsync((season.end?.getTime() ?? now) - now - 10 * 60_000)
	const html = view()
	expect(html).toContain('text-muted">Game ended')
	expect(html).toContain('aria-label="Stopped"')
	expect(html).not.toContain('aria-label="Current"')
	expect(vi.getTimerCount()).toBe(0)
	expect(fetch).not.toHaveBeenCalled()
})
