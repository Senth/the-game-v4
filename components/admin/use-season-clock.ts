"use client"

import { useEffect, useState } from "react"

export function useSeasonClock(now: number, start: Date | null, end: Date | null) {
	const [clock, setClock] = useState({ initialNow: now, currentNow: now })
	const startTime = start?.getTime() ?? null
	const endTime = end?.getTime() ?? null
	useEffect(() => {
		if (startTime === null || (endTime !== null && endTime <= now)) return
		const startedAt = performance.now()
		const timer = setInterval(() => {
			const currentNow = now + performance.now() - startedAt
			setClock({ initialNow: now, currentNow })
			if (endTime !== null && currentNow >= endTime) clearInterval(timer)
		}, 1000)
		return () => clearInterval(timer)
	}, [now, startTime, endTime])
	return clock.initialNow === now ? clock.currentNow : now
}
