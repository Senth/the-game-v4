import { FinishFlag } from "@/components/finish-flag"
import { ArcRail } from "@/components/game/arc-rail"
import type { PlayerFinisher } from "@/lib/domain/finishers"
import type { StandingsRow } from "@/lib/domain/game"

export function StandingsList({ rows, finishers = [] }: { rows: StandingsRow[]; finishers?: PlayerFinisher[] }) {
	return (
		<section aria-label="All teams">
			<h2 className="mb-1 font-cond text-xs text-muted uppercase tracking-wider">All teams</h2>
			<ol>
				{rows.map((row) => {
					const finisher = finishers.find((entry) => entry.teamId === row.id)
					return (
						<li key={row.id} className={`py-2.5 ${row.you ? "-mx-4 bg-accent/15 px-4" : "border-b border-z1"}`}>
							<div className="mb-1.5 flex items-baseline gap-2 font-cond">
								<span className="w-5 shrink-0 text-xs text-muted">{row.rank}</span>
								<span className="min-w-0 flex-1">
									<span className="flex items-center gap-1">
										<span className={`truncate text-ink ${row.you ? "font-bold" : ""}`}>{row.name}</span>
										{finisher && (
											<FinishFlag points={finisher.points} className="h-4 w-4 animate-[finisher-flag_250ms_ease-out]" />
										)}
										{finisher && finisher.points > 0 && (
											<span className="shrink-0 text-xs font-bold text-pace-ok">+{finisher.points}p</span>
										)}
									</span>
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
					)
				})}
			</ol>
		</section>
	)
}
