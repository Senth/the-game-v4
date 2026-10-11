import { formatTimeLeft } from "@/components/game/clock"
import { paceFromCounts } from "@/lib/domain/game"

export function BoardTime({ start, end, now }: { start: Date; end: Date | null; now: Date }) {
	const time = paceFromCounts({ start, end, now, solved: 0, total: 1 })
	if (!time || !end) return null
	return (
		<section>
			<div className="mb-3 flex justify-between font-cond text-3xl">
				<span>
					<span className="text-head">{formatTimeLeft(Math.min(now.getTime(), end.getTime()) - start.getTime())}</span>{" "}
					<span className="text-[28px] text-muted">elapsed</span>
				</span>
				<span>
					<span className="text-5xl font-bold text-head">{formatTimeLeft(end.getTime() - now.getTime())}</span>{" "}
					<span className="text-[28px] text-muted">left</span>
				</span>
			</div>
			<div
				className="h-6 overflow-hidden rounded-sm bg-z1"
				role="img"
				aria-label={`${Math.round(time.timePercent)}% time elapsed`}
			>
				<div className="h-full bg-time" style={{ width: `${time.timePercent}%` }} />
			</div>
		</section>
	)
}
