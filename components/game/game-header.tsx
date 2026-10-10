import type { PaceBand, RailArc, StripEntry } from "@/lib/domain/game"
import { ArcRail } from "./arc-rail"
import { formatTimeLeft } from "./clock"
import { StandingsStrip } from "./standings-strip"

const paceColors = {
	"pace-ok": "text-pace-ok",
	"pace-1": "text-pace-1",
	"pace-2": "text-pace-2",
	"pace-3": "text-pace-3",
}

export function GameHeader({
	timeLeftMs,
	pace,
	rail,
	strip,
}: {
	timeLeftMs: number
	pace: { band: PaceBand; label: string } | null
	rail: RailArc[]
	strip: StripEntry[]
}) {
	const color = pace ? paceColors[pace.band] : "text-muted"
	return (
		<header className="sticky top-0 z-10 bg-z0">
			<div className="mx-auto max-w-2xl px-4 pb-2.5">
				<div className="flex h-11 items-center justify-between font-cond">
					<span className="tabular-nums">
						<span className={`text-lg ${color}`}>{formatTimeLeft(timeLeftMs)}</span>{" "}
						<span className="text-xs text-muted">left</span>
					</span>
					{pace && <span className={`text-xs ${color}`}>{pace.label}</span>}
				</div>
				<ArcRail rail={rail} />
			</div>
			<StandingsStrip strip={strip} />
		</header>
	)
}
