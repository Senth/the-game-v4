import { ArcRail } from "@/components/game/arc-rail"
import type { StandingsRow } from "@/lib/domain/game"

export function BoardList({ rows }: { rows: StandingsRow[] }) {
	return (
		<ol>
			{rows.map((row) => (
				<li key={row.id} className="flex h-[76px] items-center gap-x-8 border-b border-z1 font-cond">
					<span className="w-12 text-3xl text-muted">{row.rank}</span>
					<span className="w-[26rem] min-w-0 truncate text-4xl text-ink">{row.name}</span>
					<span className="min-w-0 flex-1">
						<ArcRail rail={row.rail} size="tv" />
					</span>
					<span className="w-20 text-right text-3xl text-muted">
						{row.solved}/{row.total}
					</span>
					<span className="w-28 text-right text-4xl font-bold text-head">{row.score}p</span>
				</li>
			))}
		</ol>
	)
}
