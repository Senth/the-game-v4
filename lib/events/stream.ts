import { subscribe } from "./bus"

const encoder = new TextEncoder()

export function createEventStream(channels: string[], signal: AbortSignal): ReadableStream<Uint8Array> {
	let stop = () => {}
	return new ReadableStream({
		start(controller) {
			const send = (text: string) => controller.enqueue(encoder.encode(text))
			send("retry: 5000\n\n")
			const unsubscribe = subscribe(channels, ({ channel }) => send(`data: ${JSON.stringify({ channel })}\n\n`))
			const heartbeat = setInterval(() => send(": ping\n\n"), 25_000)
			const close = () => {
				stop()
				controller.close()
			}
			stop = () => {
				unsubscribe()
				clearInterval(heartbeat)
				signal.removeEventListener("abort", close)
			}
			if (signal.aborted) close()
			else signal.addEventListener("abort", close)
		},
		cancel() {
			stop()
		},
	})
}
