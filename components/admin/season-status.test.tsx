import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { SeasonStatus } from "./season-status"

type Clock = { initialNow: number; currentNow: number }
const hooks = vi.hoisted(() => ({ effects: [] as EffectCallback[], clock: null as Clock | null }))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: Clock) => [
		hooks.clock ?? initial,
		(value: Clock) => {
			hooks.clock = value
		},
	],
	useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
}))

const now = new Date("2026-10-11T17:00:00Z").getTime()
let cleanup: ReturnType<EffectCallback>

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(now + 3_600_000)
	hooks.clock = null
	hooks.effects.length = 0
})
afterEach(() => {
	cleanup?.()
	cleanup = undefined
	vi.useRealTimers()
})

it("renders server time, ticks independently of device time and flips to Ended at the boundary", async () => {
	const props = { start: new Date(now - 1000), end: new Date(now + 2000), now }
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
	renderToStaticMarkup(<SeasonStatus start={new Date(now)} end={new Date(now + 60_000)} now={now} />)
	cleanup = hooks.effects[0]?.()
	expect(vi.getTimerCount()).toBe(1)
	cleanup?.()
	expect(vi.getTimerCount()).toBe(0)
})

it.each([
	[null, null, "Not started"],
	[new Date(now - 1000), new Date(now), "Ended"],
] as const)("renders static %s chip without starting a timer", (start, end, label) => {
	expect(renderToStaticMarkup(<SeasonStatus start={start} end={end} now={now} />)).toContain(label)
	cleanup = hooks.effects[0]?.()
	expect(vi.getTimerCount()).toBe(0)
})

it("handles a live season with no end and one already at its end", () => {
	expect(renderToStaticMarkup(<SeasonStatus start={new Date(now)} end={null} now={now} />)).toContain("Live")
	expect(renderToStaticMarkup(<SeasonStatus start={new Date(now)} end={new Date(now)} now={now} />)).toContain("Ended")
})

it("counts down upcoming using server time and flips to Live then Ended without reloading", async () => {
	const props = { start: new Date(now + 2000), end: new Date(now + 4000), now }
	const html = renderToStaticMarkup(<SeasonStatus {...props} />)
	expect(html).toContain('Upcoming · in <span class="text-head">0:02</span>')
	cleanup = hooks.effects[0]?.()
	await vi.advanceTimersByTimeAsync(1000)
	expect(renderToStaticMarkup(<SeasonStatus {...props} />)).toContain("0:01")
	await vi.advanceTimersByTimeAsync(1000)
	expect(renderToStaticMarkup(<SeasonStatus {...props} />)).toContain("Live ·")
	await vi.advanceTimersByTimeAsync(2000)
	expect(renderToStaticMarkup(<SeasonStatus {...props} />)).toContain("Ended")
	expect(vi.getTimerCount()).toBe(0)
})

it("keeps Upcoming plain at exactly 24 hours and shows its countdown below that boundary", async () => {
	const props = { start: new Date(now + 86_400_000), end: new Date(now + 90_000_000), now }
	expect(renderToStaticMarkup(<SeasonStatus {...props} />)).not.toContain(" · in ")
	cleanup = hooks.effects[0]?.()
	await vi.advanceTimersByTimeAsync(1000)
	expect(renderToStaticMarkup(<SeasonStatus {...props} />)).toContain("23:59:59")
})

it("uses fresh server time immediately after a season refresh", async () => {
	const props = { start: new Date(now), end: new Date(now + 60_000), now }
	renderToStaticMarkup(<SeasonStatus {...props} />)
	cleanup = hooks.effects[0]?.()
	await vi.advanceTimersByTimeAsync(1000)
	expect(renderToStaticMarkup(<SeasonStatus {...props} now={now + 30_000} />)).toContain("0:30")
})
