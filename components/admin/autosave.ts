export type AutosaveState = "saved" | "pending" | "saving" | "failed"

export function createFieldSaver<T>({
	save,
	onState,
	delayMs = 500,
}: {
	save: (value: T) => Promise<{ ok: boolean }>
	onState: (state: AutosaveState) => void
	delayMs?: number
}) {
	let state: AutosaveState = "saved"
	let timer: ReturnType<typeof setTimeout> | undefined
	let value: T
	let hasValue = false
	let savedValue: T
	let hasSavedValue = false
	let inFlight = false
	let running: Promise<void> | undefined

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
			ok = (await save(sentValue)).ok
		} catch {}
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
		if (inFlight) return running
		if (!hasValue || unchanged()) {
			setState("saved")
			return
		}
		inFlight = true
		setState("saving")
		running = send(value)
		return running
	}

	return {
		edit(next: T) {
			value = next
			hasValue = true
			clearTimer()
			if (!inFlight && unchanged()) {
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
	const queue: Operation[] = []
	let state: AutosaveState = "saved"
	let inFlight = false

	function setState(next: AutosaveState) {
		if (state === next) return
		state = next
		onState(next)
	}

	async function drain() {
		if (inFlight || queue.length === 0) return
		inFlight = true
		setState("saving")
		while (queue.length > 0) {
			let ok = false
			try {
				ok = (await patch(queue[0] as Operation)).ok
			} catch {}
			if (!ok) {
				inFlight = false
				setState("failed")
				return
			}
			queue.shift()
		}
		inFlight = false
		setState("saved")
	}

	return {
		enqueue(op: Operation) {
			queue.push(op)
			if (state !== "failed") void drain()
		},
		applyQueued<T>(items: readonly T[], apply: (items: T[], op: Operation) => T[]): T[] {
			return queue.reduce(apply, [...items])
		},
		retry() {
			if (state === "failed") return drain()
		},
	}
}
