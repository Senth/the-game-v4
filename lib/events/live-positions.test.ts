import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { livePositionsChannel, subscribe } from "./bus"
import { publishLivePositions } from "./live-positions"

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
	vi.runAllTimers()
	vi.useRealTimers()
})

describe("live positions throttle", () => {
	it("publishes on the leading edge and every second while pending, retaining the last trailing update", () => {
		const seasonId = crypto.randomUUID()
		const start = Date.now()
		const times: number[] = []
		const unsubscribe = subscribe([livePositionsChannel(seasonId)], ({ data }) => {
			expect(data).toBeUndefined()
			times.push(Date.now() - start)
		})
		try {
			publishLivePositions(seasonId)
			expect(times).toEqual([0])
			for (let index = 0; index < 19; index++) {
				vi.advanceTimersByTime(100)
				publishLivePositions(seasonId)
			}
			expect(times).toEqual([0, 1000])
			vi.advanceTimersByTime(99)
			expect(times).toEqual([0, 1000])
			vi.advanceTimersByTime(1)
			expect(times).toEqual([0, 1000, 2000])
			vi.advanceTimersByTime(1000)
			expect(times).toEqual([0, 1000, 2000])
			expect(vi.getTimerCount()).toBe(0)
			publishLivePositions(seasonId)
			expect(times).toEqual([0, 1000, 2000, 3000])
		} finally {
			unsubscribe()
		}
	})

	it("isolates seasons and releases timers after single and trailing publishes", () => {
		const first = crypto.randomUUID()
		const second = crypto.randomUUID()
		const events: string[] = []
		const unsubscribe = subscribe([livePositionsChannel(first), livePositionsChannel(second)], ({ channel }) =>
			events.push(channel),
		)
		try {
			publishLivePositions(first)
			vi.advanceTimersByTime(250)
			publishLivePositions(first)
			publishLivePositions(second)
			expect(events).toEqual([livePositionsChannel(first), livePositionsChannel(second)])
			vi.advanceTimersByTime(750)
			expect(events).toEqual([livePositionsChannel(first), livePositionsChannel(second), livePositionsChannel(first)])
			vi.runAllTimers()
			expect(vi.getTimerCount()).toBe(0)
		} finally {
			unsubscribe()
		}
	})
})
