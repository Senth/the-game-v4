type HoldTimers = {
	now: () => number
	setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
	clearTimeout: (timer: ReturnType<typeof setTimeout>) => void
}

const defaultTimers: HoldTimers = {
	now: () => Date.now(),
	setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
	clearTimeout: (timer) => clearTimeout(timer),
}

export function createHold({
	durationMs,
	onProgress,
	onComplete,
	timers = defaultTimers,
}: {
	durationMs: number
	onProgress: (progress: number) => void
	onComplete: () => void
	timers?: HoldTimers
}) {
	let pressedAt: number | null = null
	let timer: ReturnType<typeof setTimeout> | undefined
	let completed = false

	const clearTimer = () => {
		if (timer !== undefined) timers.clearTimeout(timer)
		timer = undefined
	}

	const complete = () => {
		if (pressedAt === null || completed) return
		completed = true
		pressedAt = null
		clearTimer()
		onProgress(1)
		onComplete()
	}

	const update = () => {
		if (pressedAt === null || completed) return
		const elapsedMs = Math.max(timers.now() - pressedAt, 0)
		if (elapsedMs >= durationMs) {
			complete()
			return
		}
		onProgress(elapsedMs / durationMs)
		timer = timers.setTimeout(update, Math.min(16, durationMs - elapsedMs))
	}

	return {
		press() {
			if (pressedAt !== null || completed) return
			pressedAt = timers.now()
			if (durationMs <= 0) {
				complete()
				return
			}
			timer = timers.setTimeout(update, Math.min(16, durationMs))
			onProgress(0)
		},
		release() {
			if (pressedAt === null) return
			if (timers.now() - pressedAt >= durationMs) {
				complete()
				return
			}
			pressedAt = null
			clearTimer()
			onProgress(0)
		},
	}
}
