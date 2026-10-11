"use client"

import { useEffect, useState } from "react"
import { formatTimeLeft } from "@/components/game/clock"
import type { seasonStatus } from "@/lib/domain/admin-seasons"

export function SeasonStatus({
	status,
	end,
	now,
}: {
	status: ReturnType<typeof seasonStatus>
	end: Date | null
	now: number
}) {
	const [currentNow, setNow] = useState(now)
	const endTime = end?.getTime() ?? null
	useEffect(() => {
		if (status !== "live" || endTime === null || endTime <= now) return
		const startedAt = performance.now()
		const timer = setInterval(() => {
			const nextNow = now + performance.now() - startedAt
			setNow(nextNow)
			if (nextNow >= endTime) clearInterval(timer)
		}, 1000)
		return () => clearInterval(timer)
	}, [status, endTime, now])
	const live = status === "live" && (endTime === null || currentNow < endTime)
	if (!live) {
		return (
			<span className="inline-flex h-6 shrink-0 items-center rounded bg-z2 px-2 font-cond text-xs text-ink">
				{status === "upcoming" ? "Upcoming" : status === "unscheduled" ? "Not started" : "Ended"}
			</span>
		)
	}
	return (
		<span className="inline-flex h-7 shrink-0 items-center gap-2 rounded-full bg-pace-ok/10 px-2.5 font-cond text-xs text-ink">
			<span aria-hidden="true" className="size-2 rounded-full bg-pace-ok" />
			{endTime === null ? (
				"Live"
			) : (
				<>
					Live · <span className="text-head">{formatTimeLeft(endTime - currentNow)}</span> left
				</>
			)}
		</span>
	)
}
