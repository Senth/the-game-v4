"use client"

import { formatTimeLeft } from "@/components/game/clock"
import { seasonStatus } from "@/lib/domain/admin-seasons"
import { useSeasonClock } from "./use-season-clock"

export function SeasonStatus({ start, end, now }: { start: Date | null; end: Date | null; now: number }) {
	const currentNow = useSeasonClock(now, start, end)
	const status = seasonStatus({ start, end }, new Date(currentNow))
	const endTime = end?.getTime() ?? null
	if (status !== "live") {
		return (
			<span className="inline-flex h-6 shrink-0 items-center rounded bg-z2 px-2 font-cond text-xs text-ink">
				{status === "upcoming" ? (
					<>
						Upcoming
						{start && start.getTime() - currentNow < 86_400_000 && (
							<>
								{" · in "}
								<span className="text-head">{formatTimeLeft(start.getTime() - currentNow)}</span>
							</>
						)}
					</>
				) : status === "unscheduled" ? (
					"Not started"
				) : (
					"Ended"
				)}
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
