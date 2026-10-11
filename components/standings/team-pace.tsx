import { formatTimeLeft } from "@/components/game/clock"
import { paceFromCounts, pacePercentLabel } from "@/lib/domain/game"
import type { PlayerStandings } from "@/lib/domain/player-game"

const paceColors = {
	"pace-ok": { text: "text-pace-ok", bar: "bg-pace-ok" },
	"pace-1": { text: "text-pace-1", bar: "bg-pace-1" },
	"pace-2": { text: "text-pace-2", bar: "bg-pace-2" },
	"pace-3": { text: "text-pace-3", bar: "bg-pace-3" },
}

export function TeamPace({
	standings,
	now,
}: {
	standings: Extract<PlayerStandings, { lifecycleState: "running" }>
	now: Date
}) {
	const { you, start, end } = standings
	const pace = paceFromCounts({ start, end, solved: you.solved, total: you.total, now })
	return (
		<section className="mb-6">
			<p className="mb-3 truncate font-cond text-xs text-muted uppercase tracking-wider">{you.name}</p>
			{pace && end && (
				<>
					<div className="mb-1.5 flex justify-between font-cond text-sm">
						<span>
							<span className="text-head">
								{formatTimeLeft(Math.min(now.getTime(), end.getTime()) - start.getTime())}
							</span>{" "}
							<span className="text-xs text-muted">elapsed</span>
						</span>
						<span>
							<span className="text-head">{formatTimeLeft(end.getTime() - now.getTime())}</span>{" "}
							<span className="text-xs text-muted">left</span>
						</span>
					</div>
					<div
						className="h-3 overflow-hidden rounded-sm bg-z1"
						role="img"
						aria-label={`${Math.round(pace.timePercent)}% time elapsed`}
					>
						<div className="h-full bg-time" style={{ width: `${pace.timePercent}%` }} />
					</div>
				</>
			)}
			<div className="mt-4 mb-1.5 flex justify-between font-cond text-sm">
				<span className="text-xs text-muted">Quests</span>
				<span>
					<span className="text-head">
						{you.solved} / {you.total}
					</span>
					{pace && (
						<>
							{" "}
							<span className={`text-xs font-bold ${paceColors[pace.band].text}`}>
								{pacePercentLabel(pace.behindPercent)}
							</span>
						</>
					)}
				</span>
			</div>
			{pace && (
				<div
					className="relative h-3 rounded-sm bg-z1"
					role="img"
					aria-label={`${you.solved} of ${you.total} quests solved`}
				>
					<div
						className={`h-full rounded-sm ${paceColors[pace.band].bar}`}
						style={{ width: `${pace.solvedPercent}%` }}
					/>
					<div className="absolute -top-1 -bottom-1 w-0.5 bg-ink" style={{ left: `${pace.timePercent}%` }} />
				</div>
			)}
		</section>
	)
}
