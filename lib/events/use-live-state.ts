"use client"

import { type Dispatch, type SetStateAction, useEffect, useEffectEvent, useState } from "react"
import { createLiveConnection } from "./live-connection"

export function useLiveState<T>(
	fetcher: () => Promise<T>,
	channels: string[],
	initial: T,
): [T, Dispatch<SetStateAction<T>>] {
	const [state, setState] = useState(initial)
	const fetchLatest = useEffectEvent(fetcher)
	const key = [...channels].sort().join(",")

	useEffect(() => {
		const query = new URLSearchParams(key.split(",").map((channel) => ["channel", channel]))
		const connection = createLiveConnection({
			url: `/api/events?${query}`,
			fetcher: () => fetchLatest(),
			onData: setState,
			createEventSource: (url) => new EventSource(url),
		})
		const onVisibilityChange = () => connection.setHidden(document.hidden)
		document.addEventListener("visibilitychange", onVisibilityChange)
		if (document.hidden) connection.setHidden(true)
		connection.start()
		return () => {
			document.removeEventListener("visibilitychange", onVisibilityChange)
			connection.stop()
		}
	}, [key])

	return [state, setState]
}
