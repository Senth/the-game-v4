import { afterEach, describe, expect, it, vi } from "vitest"
import { createHold } from "./hold"

afterEach(() => {
	vi.useRealTimers()
})

describe("createHold", () => {
	it("cancels a hold released at 1.9 seconds", () => {
		vi.useFakeTimers()
		const onProgress = vi.fn()
		const onComplete = vi.fn()
		const hold = createHold({ durationMs: 2000, onProgress, onComplete })

		hold.press()
		vi.advanceTimersByTime(1900)
		hold.release()

		expect(onComplete).not.toHaveBeenCalled()
		expect(onProgress).toHaveBeenLastCalledWith(0)
		expect(vi.getTimerCount()).toBe(0)
	})

	it("completes once after a full hold", () => {
		vi.useFakeTimers()
		const onProgress = vi.fn()
		const onComplete = vi.fn()
		const hold = createHold({ durationMs: 2000, onProgress, onComplete })

		hold.press()
		vi.advanceTimersByTime(2000)
		hold.release()
		hold.press()
		vi.advanceTimersByTime(2000)

		expect(onComplete).toHaveBeenCalledTimes(1)
		expect(onProgress).toHaveBeenLastCalledWith(1)
	})

	it("restarts from zero after an early release", () => {
		vi.useFakeTimers()
		const onProgress = vi.fn()
		const onComplete = vi.fn()
		const hold = createHold({ durationMs: 2000, onProgress, onComplete })

		hold.press()
		vi.advanceTimersByTime(1900)
		hold.release()
		hold.press()

		expect(onProgress).toHaveBeenLastCalledWith(0)
		vi.advanceTimersByTime(1999)
		expect(onComplete).not.toHaveBeenCalled()
		vi.advanceTimersByTime(1)
		expect(onComplete).toHaveBeenCalledTimes(1)
	})
})
