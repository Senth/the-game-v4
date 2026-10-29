"use client"

import { type Dispatch, type SetStateAction, useEffect, useEffectEvent, useState } from "react"
import type { Positions } from "@/lib/game/positions"
import { createLiveConnection } from "./live-connection"

export function useLiveState<T>(
	fetcher: () => Promise<T>,
	channels: string[] | ((state: T) => string[]),
	initial: T,
	options?: { onPositions?: (data: Positions) => void; scope?: (state: T) => string | undefined },
): [T, Dispatch<SetStateAction<T>>] {
	const [state, setState] = useState(initial)
	const fetchLatest = useEffectEvent(fetcher)
	const receivePositions = useEffectEvent((data: Positions, receivedScope: string | undefined) => {
		if (options?.scope?.(state) === receivedScope) options?.onPositions?.(data)
	})
	const key = [...(typeof channels === "function" ? channels(state) : channels)].sort().join(",")
	const scope = options?.scope?.(state)

	useEffect(() => {
		if (!key) return
		const query = new URLSearchParams(key.split(",").map((channel) => ["channel", channel]))
		const connection = createLiveConnection({
			url: `/api/events?${query}`,
			fetcher: () => fetchLatest(),
			onData: setState,
			onPositions: (data) => receivePositions(data, scope),
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
	}, [key, scope])

	return [state, setState]
}
