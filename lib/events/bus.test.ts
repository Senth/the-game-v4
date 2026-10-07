import { afterEach, describe, expect, it, vi } from "vitest"
import { boardChannel, type Listener, publish, seasonChannel, subscribe, teamChannel } from "./bus"

const bus = (globalThis as typeof globalThis & { theGameBus: Map<string, Set<Listener>> }).theGameBus

afterEach(() => {
	bus.clear()
	vi.restoreAllMocks()
})

describe("bus", () => {
	it("names channels", () => {
		expect([teamChannel("a"), seasonChannel("s"), boardChannel]).toEqual(["team:a", "season:s", "board"])
	})

	it("delivers only the subscribed channel", () => {
		const listener = vi.fn()
		subscribe(["team:a"], listener)
		publish("team:b")
		publish("team:a")
		expect(listener.mock.calls).toEqual([[{ channel: "team:a" }]])
	})

	it("delivers each channel of one subscription and nothing after unsubscribe", () => {
		const listener = vi.fn()
		const unsubscribe = subscribe(["team:a", "board"], listener)
		publish("board")
		publish("team:a")
		expect(listener.mock.calls).toEqual([[{ channel: "board" }], [{ channel: "team:a" }]])
		unsubscribe()
		publish("board")
		publish("team:a")
		expect(listener).toHaveBeenCalledTimes(2)
		expect(bus.size).toBe(0)
	})

	it("keeps channels that still have listeners", () => {
		const unsubscribe = subscribe(["board"], vi.fn())
		subscribe(["board"], vi.fn())
		unsubscribe()
		expect(bus.get("board")?.size).toBe(1)
	})

	it("keeps delivering when a listener throws", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {})
		const after = vi.fn()
		subscribe(["board"], () => {
			throw new Error("boom")
		})
		subscribe(["board"], after)
		publish("board")
		expect(after).toHaveBeenCalledWith({ channel: "board" })
		expect(error).toHaveBeenCalledOnce()
	})
})
