export type AutosaveState = "saved" | "pending" | "saving" | "failed"

export function createFieldSaver<T>({
	save,
	onState,
	delayMs = 500,
}: {
	save: (value: T) => Promise<{ ok: boolean; error?: string }>
	onState: (state: AutosaveState) => void
	delayMs?: number
}) {
	let state: AutosaveState = "saved"
	let error: string | undefined
	let timer: ReturnType<typeof setTimeout> | undefined
	let value: T
	let hasValue = false
	let savedValue: T
	let hasSavedValue = false
	let inFlight = false
	let running: Promise<void> | undefined
	let canceled = false

	function setState(next: AutosaveState) {
		if (state === next) return
		state = next
		onState(next)
	}

	function clearTimer() {
		clearTimeout(timer)
		timer = undefined
	}

	function unchanged() {
		return hasSavedValue && Object.is(value, savedValue)
	}

	async function send(sentValue: T) {
		let ok = false
		try {
			const result = await save(sentValue)
			ok = result.ok
			error = ok ? undefined : result.error
		} catch {
			error = undefined
		}
		if (canceled) return
		inFlight = false
		if (!ok) {
			clearTimer()
			setState("failed")
			return
		}
		savedValue = sentValue
		hasSavedValue = true
		if (unchanged()) {
			clearTimer()
			setState("saved")
		} else if (timer !== undefined) {
			setState("pending")
		} else {
			await flush()
		}
	}

	async function flush(): Promise<void> {
		clearTimer()
		if (canceled) return
		if (inFlight) return running
		if (!hasValue || unchanged()) {
			error = undefined
			setState("saved")
			return
		}
		inFlight = true
		setState("saving")
		running = send(value)
		return running
	}

	return {
		cancel() {
			canceled = true
			clearTimer()
		},
		get error() {
			return error
		},
		sync(next: T) {
			if (canceled || state !== "saved" || inFlight) return
			value = savedValue = next
			hasValue = hasSavedValue = true
		},
		edit(next: T) {
			if (canceled) return
			value = next
			hasValue = true
			clearTimer()
			if (!inFlight && unchanged()) {
				error = undefined
				setState("saved")
				return
			}
			if (!inFlight) setState("pending")
			timer = setTimeout(() => void flush(), delayMs)
		},
		blur: flush,
		flush,
		retry() {
			if (state === "failed") return flush()
		},
	}
}

export function createListSaver<Operation>({
	patch,
	onState,
}: {
	patch: (op: Operation) => Promise<{ ok: boolean }>
	onState: (state: AutosaveState) => void
}) {
	const queue: { op: Operation; saved: Promise<boolean>; resolve: (saved: boolean) => void }[] = []
	let state: AutosaveState = "saved"
	let inFlight = false
	let running: Promise<void> | undefined
	let canceled = false

	function setState(next: AutosaveState) {
		if (state === next) return
		state = next
		onState(next)
	}

	async function drain() {
		if (canceled || inFlight || queue.length === 0) return
		inFlight = true
		setState("saving")
		while (queue.length > 0) {
			const next = queue[0]
			if (!next) break
			let ok = false
			try {
				ok = (await patch(next.op)).ok
			} catch {}
			if (canceled) return
			if (!ok) {
				inFlight = false
				setState("failed")
				return
			}
			queue.shift()?.resolve(true)
		}
		inFlight = false
		setState("saved")
	}

	return {
		cancel() {
			canceled = true
			for (const item of queue) item.resolve(false)
			queue.length = 0
		},
		queued(matches: (op: Operation) => boolean) {
			return queue.find((item) => matches(item.op))
		},
		enqueue(op: Operation) {
			if (canceled) return Promise.resolve(false)
			let resolve!: (saved: boolean) => void
			const saved = new Promise<boolean>((done) => {
				resolve = done
			})
			queue.push({ op, saved, resolve })
			if (state !== "failed" && !inFlight) running = drain()
			return saved
		},
		applyQueued<T>(items: readonly T[], apply: (items: T[], op: Operation) => T[]): T[] {
			return queue.reduce((current, item) => apply(current, item.op), [...items])
		},
		retry() {
			if (state === "failed") running = drain()
			return running
		},
	}
}
