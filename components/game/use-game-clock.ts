"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import type { LifecycleState } from "@/lib/domain/game"
import { endRefreshDelay } from "./end-refresh"

type ClockState = { lifecycleState: LifecycleState; start?: Date; end?: Date | null }

export function useGameClock<T extends ClockState>(
	game: T,
	initialNow: number,
	fetcher: () => Promise<T>,
	setGame: (next: T) => void,
) {
	const [now, setNow] = useState(() => new Date(initialNow))
	const clockStartedAt = useRef(0)
	const [, startTransition] = useTransition()
	useEffect(() => {
		clockStartedAt.current = performance.now()
		const timer = setInterval(() => setNow(new Date(initialNow + performance.now() - clockStartedAt.current)), 1000)
		return () => clearInterval(timer)
	}, [initialNow])
	const refreshAt =
		game.lifecycleState === "countdown"
			? (game.start?.getTime() ?? null)
			: game.lifecycleState === "running"
				? (game.end?.getTime() ?? null)
				: null
	useEffect(() => {
		if (refreshAt === null) return
		let cancelled = false
		let attempt = 0
		let timer: ReturnType<typeof setTimeout>
		const schedule = () => {
			const currentNow = initialNow + performance.now() - clockStartedAt.current
			timer = setTimeout(
				() => {
					const boundaryNow = initialNow + performance.now() - clockStartedAt.current
					if (boundaryNow < refreshAt) {
						schedule()
						return
					}
					setNow(new Date(boundaryNow))
					startTransition(async () => {
						try {
							const next = await fetcher()
							if (cancelled) return
							setGame(next)
							const nextRefreshAt =
								next.lifecycleState === "countdown"
									? next.start?.getTime()
									: next.lifecycleState === "running"
										? next.end?.getTime()
										: null
							if (next.lifecycleState !== game.lifecycleState || nextRefreshAt !== refreshAt) return
						} catch {}
						if (!cancelled) {
							attempt++
							schedule()
						}
					})
				},
				Math.min(endRefreshDelay(refreshAt, currentNow, attempt), 2_147_483_647),
			)
		}
		schedule()
		return () => {
			cancelled = true
			clearTimeout(timer)
		}
	}, [refreshAt, game.lifecycleState, initialNow, fetcher, setGame])
	return now
}
