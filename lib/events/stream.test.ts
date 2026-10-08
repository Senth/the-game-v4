import { afterEach, describe, expect, it, vi } from "vitest"
import { type Listener, publish } from "./bus"
import { createEventStream } from "./stream"

const bus = (globalThis as typeof globalThis & { theGameBus: Map<string, Set<Listener>> }).theGameBus
const decoder = new TextDecoder()

async function next(reader: ReadableStreamDefaultReader<Uint8Array>) {
	const { value } = await reader.read()
	return decoder.decode(value)
}

afterEach(() => {
	bus.clear()
	vi.useRealTimers()
})

describe("createEventStream", () => {
	it("sends retry, then only the subscribed channel's events", async () => {
		const reader = createEventStream(["team:a"], new AbortController().signal).getReader()
		expect(await next(reader)).toBe("retry: 5000\n\n")
		publish("team:b")
		publish("team:a")
		expect(await next(reader)).toBe('data: {"channel":"team:a"}\n\n')
		await reader.cancel()
	})

	it("sends a ping every 25 seconds", async () => {
		vi.useFakeTimers()
		const reader = createEventStream(["board"], new AbortController().signal).getReader()
		await next(reader)
		vi.advanceTimersByTime(24_999)
		publish("board")
		expect(await next(reader)).toBe('data: {"channel":"board"}\n\n')
		vi.advanceTimersByTime(1)
		expect(await next(reader)).toBe(": ping\n\n")
		await reader.cancel()
	})

	it("unsubscribes and stops the heartbeat on abort", async () => {
		vi.useFakeTimers()
		const abort = new AbortController()
		const reader = createEventStream(["team:a", "board"], abort.signal).getReader()
		await next(reader)
		expect(bus.size).toBe(2)
		abort.abort()
		expect(bus.size).toBe(0)
		expect(vi.getTimerCount()).toBe(0)
		expect(await reader.read()).toEqual({ done: true, value: undefined })
	})

	it("unsubscribes and stops the heartbeat on cancel", async () => {
		vi.useFakeTimers()
		const reader = createEventStream(["board"], new AbortController().signal).getReader()
		await reader.cancel()
		expect(bus.size).toBe(0)
		expect(vi.getTimerCount()).toBe(0)
	})

	it("closes at once for an already aborted signal", async () => {
		vi.useFakeTimers()
		const reader = createEventStream(["board"], AbortSignal.abort()).getReader()
		expect(await next(reader)).toBe("retry: 5000\n\n")
		expect(await reader.read()).toEqual({ done: true, value: undefined })
		expect(bus.size).toBe(0)
		expect(vi.getTimerCount()).toBe(0)
	})
})
