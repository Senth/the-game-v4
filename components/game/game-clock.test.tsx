import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getGame } from "@/app/actions"
import type { PlayerGame } from "@/lib/domain/player-game"
import { endRefreshDelay } from "./end-refresh"
import { GameScreen } from "./game-screen"

const hooks = vi.hoisted(() => ({
	effects: [] as EffectCallback[],
	setNow: vi.fn(),
	setGame: vi.fn(),
}))

vi.mock("react", async (importOriginal) => {
	const react = await importOriginal<typeof import("react")>()
	return {
		...react,
		useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
		useState: (initial: unknown) => {
			const [value, setter] = react.useState(initial)
			return [value, value instanceof Date ? hooks.setNow : setter]
		},
		useTransition: () => [false, (callback: () => void) => callback()],
	}
})
vi.mock("@/app/actions", () => ({ getGame: vi.fn(), submitAnswer: vi.fn(), revealHint: vi.fn() }))
vi.mock("@/lib/events/use-live-state", () => ({
	useLiveState: (_fetcher: unknown, _channels: unknown, initial: PlayerGame) => [initial, hooks.setGame],
}))

const initialNow = new Date("2026-10-10T18:00:00Z").getTime()
const running: PlayerGame = {
	lifecycleState: "running",
	start: new Date(initialNow - 60_000),
	end: new Date(initialNow + 1000),
	score: 42,
	solved: 0,
	total: 1,
	pace: null,
	rail: [],
	strip: [],
	quest: null,
}
const ended: PlayerGame = { lifecycleState: "ended", score: 42 }
let cleanups: (() => void)[] = []

function mount(initial = running) {
	renderToStaticMarkup(<GameScreen initial={initial} initialNow={initialNow} channels={[]} />)
	cleanups = hooks.effects.map((effect) => effect()).filter((cleanup): cleanup is () => void => !!cleanup)
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(initialNow + 3_600_000)
	hooks.effects.length = 0
	vi.clearAllMocks()
})

afterEach(() => {
	for (const cleanup of cleanups) cleanup()
	cleanups = []
	vi.useRealTimers()
})

describe("game clock effects", () => {
	it("waits for the boundary and caps exponential retry backoff at 30 seconds", () => {
		expect(endRefreshDelay(initialNow + 1000, initialNow, 0)).toBe(1000)
		expect(endRefreshDelay(initialNow, initialNow, 0)).toBe(0)
		expect([1, 2, 3, 6, 100].map((attempt) => endRefreshDelay(initialNow, initialNow + 1, attempt))).toEqual([
			1000, 2000, 4000, 30_000, 30_000,
		])
	})

	it("anchors ticks to server time even when phone time is ahead or changes", async () => {
		vi.mocked(getGame).mockResolvedValue(ended)
		mount()
		vi.setSystemTime(initialNow + 7_200_000)
		await vi.advanceTimersByTimeAsync(999)
		expect(getGame).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		expect(hooks.setNow).toHaveBeenLastCalledWith(new Date(initialNow + 1000))
		expect(getGame).toHaveBeenCalledOnce()
	})

	it("never overlaps refreshes and ignores in-flight results after effect cleanup", async () => {
		let finish!: (game: PlayerGame) => void
		vi.mocked(getGame).mockReturnValueOnce(
			new Promise((resolve) => {
				finish = resolve
			}),
		)
		mount()
		await vi.advanceTimersByTimeAsync(60_000)
		expect(getGame).toHaveBeenCalledOnce()
		for (const cleanup of cleanups) cleanup()
		finish(running)
		await vi.advanceTimersByTimeAsync(60_000)
		expect(hooks.setGame).not.toHaveBeenCalled()
		expect(getGame).toHaveBeenCalledOnce()
		expect(vi.getTimerCount()).toBe(0)
	})

	it.each(["failed", "still-running"])(
		"retries a %s boundary refresh until ended without an SSE event",
		async (result) => {
			const boundary = { ...running, end: new Date(initialNow) }
			if (result === "failed") vi.mocked(getGame).mockRejectedValueOnce(new Error("Offline"))
			else vi.mocked(getGame).mockResolvedValueOnce(boundary)
			vi.mocked(getGame).mockResolvedValueOnce(boundary).mockResolvedValue(ended)
			mount(boundary)
			await vi.advanceTimersByTimeAsync(0)
			expect(getGame).toHaveBeenCalledTimes(1)
			await vi.advanceTimersByTimeAsync(999)
			expect(getGame).toHaveBeenCalledTimes(1)
			await vi.advanceTimersByTimeAsync(1)
			expect(getGame).toHaveBeenCalledTimes(2)
			await vi.advanceTimersByTimeAsync(1999)
			expect(getGame).toHaveBeenCalledTimes(2)
			await vi.advanceTimersByTimeAsync(1)
			expect(hooks.setGame).toHaveBeenLastCalledWith(ended)
			await vi.advanceTimersByTimeAsync(60_000)
			expect(getGame).toHaveBeenCalledTimes(3)
		},
	)
})
