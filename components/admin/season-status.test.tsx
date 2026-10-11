import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { SeasonStatus } from "./season-status"

const hooks = vi.hoisted(() => ({ effects: [] as EffectCallback[], now: null as number | null }))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: number) => [
		hooks.now ?? initial,
		(value: number) => {
			hooks.now = value
		},
	],
	useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
}))

const now = new Date("2026-10-11T17:00:00Z").getTime()
let cleanup: ReturnType<EffectCallback>

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(now + 3_600_000)
	hooks.now = null
	hooks.effects.length = 0
})
afterEach(() => {
	cleanup?.()
	cleanup = undefined
	vi.useRealTimers()
})

it("renders server time, ticks independently of device time and flips to Ended at the boundary", async () => {
	const props = { status: "live" as const, end: new Date(now + 2000), now }
	expect(renderToStaticMarkup(<SeasonStatus {...props} />)).toContain("0:02")
	cleanup = hooks.effects[0]?.()
	vi.setSystemTime(now + 7_200_000)
	await vi.advanceTimersByTimeAsync(1000)
	expect(renderToStaticMarkup(<SeasonStatus {...props} />)).toContain("0:01")
	await vi.advanceTimersByTimeAsync(1000)
	const html = renderToStaticMarkup(<SeasonStatus {...props} />)
	expect(html).toContain("Ended")
	expect(html).not.toContain("Live")
	expect(html).not.toContain("pace-ok")
	expect(vi.getTimerCount()).toBe(0)
})

it("clears the ticking timer on unmount", () => {
	renderToStaticMarkup(<SeasonStatus status="live" end={new Date(now + 60_000)} now={now} />)
	cleanup = hooks.effects[0]?.()
	expect(vi.getTimerCount()).toBe(1)
	cleanup?.()
	expect(vi.getTimerCount()).toBe(0)
})

it.each([
	["upcoming", "Upcoming"],
	["unscheduled", "Not started"],
	["ended", "Ended"],
] as const)("renders static %s chip without starting a timer", (status, label) => {
	expect(renderToStaticMarkup(<SeasonStatus status={status} end={null} now={now} />)).toContain(label)
	cleanup = hooks.effects[0]?.()
	expect(vi.getTimerCount()).toBe(0)
})

it("handles a live season with no end and one already at its end", () => {
	expect(renderToStaticMarkup(<SeasonStatus status="live" end={null} now={now} />)).toContain("Live")
	expect(renderToStaticMarkup(<SeasonStatus status="live" end={new Date(now)} now={now} />)).toContain("Ended")
	for (const effect of hooks.effects) effect()
	expect(vi.getTimerCount()).toBe(0)
})
