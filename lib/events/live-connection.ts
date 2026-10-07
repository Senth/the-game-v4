export type LiveSource = Pick<EventSource, "readyState" | "close" | "onopen" | "onmessage" | "onerror">

const CLOSED = 2
const retryMs = 5000

export function createLiveConnection<T>({
	url,
	fetcher,
	onData,
	createEventSource,
}: {
	url: string
	fetcher: () => Promise<T>
	onData: (data: T) => void
	createEventSource: (url: string) => LiveSource
}) {
	let source: LiveSource | null = null
	let pollTimer: ReturnType<typeof setInterval> | undefined
	let reconnectTimer: ReturnType<typeof setTimeout> | undefined
	let disconnected = false
	let hidden = false
	let stopped = false
	let inFlight = false
	let queued = false

	async function refetch() {
		if (inFlight) {
			queued = true
			return
		}
		inFlight = true
		try {
			const data = await fetcher()
			if (!stopped) onData(data)
		} catch {}
		inFlight = false
		if (queued && !stopped) {
			queued = false
			void refetch()
		}
	}

	function stopPolling() {
		clearInterval(pollTimer)
		pollTimer = undefined
	}

	function poll() {
		if (disconnected && !hidden && !pollTimer) pollTimer = setInterval(refetch, retryMs)
	}

	function connect() {
		reconnectTimer = undefined
		source?.close()
		source = createEventSource(url)
		source.onmessage = () => void refetch()
		source.onopen = () => {
			disconnected = false
			stopPolling()
			void refetch()
		}
		source.onerror = () => {
			disconnected = true
			poll()
			if (source?.readyState === CLOSED && !reconnectTimer) reconnectTimer = setTimeout(connect, retryMs)
		}
	}

	return {
		start: connect,
		stop() {
			stopped = true
			source?.close()
			source = null
			stopPolling()
			clearTimeout(reconnectTimer)
		},
		setHidden(value: boolean) {
			hidden = value
			if (hidden) return stopPolling()
			void refetch()
			poll()
		},
	}
}
