import { ArcRail } from "@/components/game/arc-rail"
import type { StandingsRow } from "@/lib/domain/game"

export function StandingsList({ rows }: { rows: StandingsRow[] }) {
	return (
		<section aria-label="All teams">
			<h2 className="mb-1 font-cond text-xs text-muted uppercase tracking-wider">All teams</h2>
			<ol>
				{rows.map((row) => (
					<li key={row.id} className={`py-2.5 ${row.you ? "-mx-4 bg-accent/15 px-4" : "border-b border-z1"}`}>
						<div className="mb-1.5 flex items-baseline gap-2 font-cond">
							<span className="w-5 shrink-0 text-xs text-muted">{row.rank}</span>
							<span className="min-w-0 flex-1">
								<span className={`block truncate text-ink ${row.you ? "font-bold" : ""}`}>{row.name}</span>
							</span>
							<span className="shrink-0 text-xs text-muted">
								{row.solved}/{row.total}
							</span>
							<span className="w-12 shrink-0 text-right font-bold text-head">{row.score}p</span>
						</div>
						<div className="pl-7">
							<ArcRail rail={row.rail} size="small" />
						</div>
					</li>
				))}
			</ol>
		</section>
	)
}
