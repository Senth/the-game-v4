import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createLiveConnection, type LiveSource } from "./live-connection"

class FakeSource implements LiveSource {
	readyState = 0
	onopen: (() => void) | null = null
	onmessage: (() => void) | null = null
	onerror: (() => void) | null = null
	close = vi.fn(() => {
		this.readyState = 2
	})
	open() {
		this.readyState = 1
		this.onopen?.()
	}
	fail(readyState: number) {
		this.readyState = readyState
		this.onerror?.()
	}
}

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

function setup(fetcher: () => Promise<number> = vi.fn(async () => 1)) {
	const sources: FakeSource[] = []
	const onData = vi.fn()
	const connection = createLiveConnection({
		url: "/api/events?channel=board",
		fetcher,
		onData,
		createEventSource: (url) => {
			expect(url).toBe("/api/events?channel=board")
			const source = new FakeSource()
			sources.push(source)
			return source
		},
	})
	connection.start()
	return { connection, sources, onData, fetcher, source: () => sources.at(-1) as FakeSource }
}

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
})

describe("createLiveConnection", () => {
	it("refetches on message", async () => {
		const { source, onData } = setup()
		source().open()
		await vi.advanceTimersByTimeAsync(0)
		source().onmessage?.()
		await vi.advanceTimersByTimeAsync(0)
		expect(onData).toHaveBeenCalledTimes(2)
	})

	it("polls every 5 s after an error and stops polling with one refetch on open", async () => {
		const { source, fetcher } = setup()
		source().fail(0)
		await vi.advanceTimersByTimeAsync(4999)
		expect(fetcher).toHaveBeenCalledTimes(0)
		await vi.advanceTimersByTimeAsync(1)
		expect(fetcher).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(5000)
		expect(fetcher).toHaveBeenCalledTimes(2)
		source().open()
		await vi.advanceTimersByTimeAsync(0)
		expect(fetcher).toHaveBeenCalledTimes(3)
		await vi.advanceTimersByTimeAsync(20_000)
		expect(fetcher).toHaveBeenCalledTimes(3)
	})

	it("recreates a CLOSED source after 5 s and keeps polling meanwhile", async () => {
		const { sources, source, fetcher } = setup()
		source().fail(2)
		await vi.advanceTimersByTimeAsync(4999)
		expect(sources).toHaveLength(1)
		await vi.advanceTimersByTimeAsync(1)
		expect(sources).toHaveLength(2)
		expect(fetcher).toHaveBeenCalledTimes(1)
		source().fail(2)
		await vi.advanceTimersByTimeAsync(5000)
		expect(sources).toHaveLength(3)
		expect(fetcher).toHaveBeenCalledTimes(2)
		source().open()
		await vi.advanceTimersByTimeAsync(10_000)
		expect(fetcher).toHaveBeenCalledTimes(3)
		expect(sources).toHaveLength(3)
	})

	it("runs one fetch in flight plus one queued, applying responses in order", async () => {
		const slow = deferred<number>()
		const fetcher = vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValueOnce(2)
		const { source, onData } = setup(fetcher)
		source().open()
		for (let i = 0; i < 5; i++) source().onmessage?.()
		await vi.advanceTimersByTimeAsync(0)
		expect(fetcher).toHaveBeenCalledTimes(1)
		slow.resolve(1)
		await vi.advanceTimersByTimeAsync(0)
		expect(fetcher).toHaveBeenCalledTimes(2)
		expect(onData.mock.calls).toEqual([[1], [2]])
	})

	it("drops a response that arrives after stop", async () => {
		const slow = deferred<number>()
		const { source, onData, connection } = setup(vi.fn().mockReturnValueOnce(slow.promise))
		source().open()
		connection.stop()
		slow.resolve(1)
		await vi.advanceTimersByTimeAsync(0)
		expect(onData).not.toHaveBeenCalled()
	})

	it("keeps the last state and keeps polling when a fetch rejects", async () => {
		const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(2)
		const { source, onData } = setup(fetcher)
		source().fail(0)
		await vi.advanceTimersByTimeAsync(5000)
		expect(onData).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(5000)
		expect(onData.mock.calls).toEqual([[2]])
	})

	it("pauses polling while hidden and refetches at once when visible", async () => {
		const { source, fetcher, connection } = setup()
		source().fail(0)
		connection.setHidden(true)
		await vi.advanceTimersByTimeAsync(20_000)
		expect(fetcher).toHaveBeenCalledTimes(0)
		expect(source().close).not.toHaveBeenCalled()
		connection.setHidden(false)
		await vi.advanceTimersByTimeAsync(0)
		expect(fetcher).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(5000)
		expect(fetcher).toHaveBeenCalledTimes(2)
	})

	it("does not poll after becoming visible while connected", async () => {
		const { source, fetcher, connection } = setup()
		source().open()
		connection.setHidden(true)
		connection.setHidden(false)
		await vi.advanceTimersByTimeAsync(20_000)
		expect(fetcher).toHaveBeenCalledTimes(2)
	})

	it("closes the source and leaves no timers on stop", async () => {
		const { source, connection } = setup()
		source().fail(2)
		expect(vi.getTimerCount()).toBe(2)
		connection.stop()
		expect(source().close).toHaveBeenCalled()
		expect(vi.getTimerCount()).toBe(0)
	})
})
