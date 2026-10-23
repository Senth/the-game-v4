import type { EffectCallback } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { GameView } from "./game-view"

const hooks = vi.hoisted(() => ({ effects: [] as EffectCallback[], refs: [] as unknown[] }))
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
	useRef: () => ({ current: hooks.refs.shift() }),
}))

afterEach(() => {
	hooks.effects = []
	vi.unstubAllGlobals()
})

it("reserves unscaled dock height so long permission help stays clear in player and framed previews", () => {
	const style = { paddingBottom: "", removeProperty: vi.fn() }
	const bar = { getBoundingClientRect: () => ({ height: 196.8 }) }
	const observe = vi.fn()
	const disconnect = vi.fn()
	let resized!: ResizeObserverCallback
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(callback: ResizeObserverCallback) {
				resized = callback
			}
			observe = observe
			disconnect = disconnect
		},
	)
	hooks.refs = [{ style }, { firstElementChild: bar }]
	GameView({
		preview: true,
		timeLeftMs: 0,
		pace: null,
		rail: [],
		quest: {
			id: "place",
			displayTitle: "",
			content: "Clue",
			points: 20,
			worth: 20,
			hints: [],
			location: { guidance: "none" },
			hasAnswers: false,
		},
	})
	const cleanup = hooks.effects[0]?.()
	expect(observe).toHaveBeenCalledWith(bar)
	resized(
		[{ borderBoxSize: [{ blockSize: 240 }], contentRect: { height: 200 } }] as unknown as ResizeObserverEntry[],
		{} as ResizeObserver,
	)
	expect(style.paddingBottom).toBe("calc(240px + var(--spacing) * 5)")
	if (cleanup) cleanup()
	expect(disconnect).toHaveBeenCalledOnce()
	expect(style.removeProperty).toHaveBeenCalledWith("padding-bottom")
})
