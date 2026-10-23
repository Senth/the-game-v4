import type { EffectCallback } from "react"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useLiveState } from "./use-live-state"

const hooks = vi.hoisted(() => ({ effects: [] as EffectCallback[] }))

vi.mock("react", async (importOriginal) => {
	const react = await importOriginal<typeof import("react")>()
	return {
		...react,
		useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
		useEffectEvent: (callback: unknown) => callback,
	}
})

function HookHarness({ channels }: { channels: string[] }) {
	useLiveState(async () => "updated", channels, "initial")
	return null
}

let cleanups: (() => void)[] = []
let source = {
	readyState: 1,
	onopen: null as (() => void) | null,
	onmessage: null as (() => void) | null,
	onerror: null as (() => void) | null,
	close: vi.fn(),
}

function mount(channels: string[]) {
	renderToStaticMarkup(createElement(HookHarness, { channels }))
	cleanups = hooks.effects.map((effect) => effect()).filter((cleanup): cleanup is () => void => !!cleanup)
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.clearAllMocks()
	hooks.effects.length = 0
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
	vi.restoreAllMocks()
	vi.useRealTimers()
})

describe("useLiveState", () => {
	it("does not connect or poll when channel list is empty", () => {
		const setInterval = vi.spyOn(globalThis, "setInterval")
		mount([])
		expect(EventSource).not.toHaveBeenCalled()
		expect(setInterval).not.toHaveBeenCalled()
	})

	it("connects to the requested channel", () => {
		mount(["board"])
		expect(EventSource).toHaveBeenCalledExactlyOnceWith("/api/events?channel=board")
	})
})
