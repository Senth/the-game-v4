import { FinishFlag } from "@/components/finish-flag"
import { ArcRail } from "@/components/game/arc-rail"
import type { PlayerFinisher } from "@/lib/domain/finishers"
import type { StandingsRow } from "@/lib/domain/game"

export function BoardList({ rows, finishers = [] }: { rows: StandingsRow[]; finishers?: PlayerFinisher[] }) {
	const visible = rows.slice(0, 24)
	const twoColumns = visible.length > 12
	const rowsPerColumn = twoColumns ? Math.ceil(visible.length / 2) : visible.length
	const columns = twoColumns ? [visible.slice(0, rowsPerColumn), visible.slice(rowsPerColumn)] : [visible]
	return (
		<div className={`grid min-h-0 flex-1 ${twoColumns ? "grid-cols-2 gap-x-16" : "grid-cols-1"}`}>
			{columns.map((column, index) => (
				<ol
					key={column[0]?.id ?? index}
					className="grid min-h-0 content-start"
					style={{ gridTemplateRows: rowsPerColumn ? `repeat(${rowsPerColumn}, minmax(0, 76px))` : undefined }}
				>
					{column.map((row) => {
						const finisher = finishers.find((entry) => entry.teamId === row.id)
						return (
							<li key={row.id} className="flex min-h-0 items-center gap-x-8 border-b border-z1 font-cond">
								<span className="w-12 text-3xl text-muted">{row.rank}</span>
								<span
									className={`${twoColumns ? "w-[15rem]" : "w-[26rem]"} flex min-w-0 items-center gap-2 text-4xl text-ink`}
								>
									<span className="truncate">{row.name}</span>
									{finisher && <FinishFlag points={finisher.points} className="h-8 w-8" />}
									{finisher && finisher.points > 0 && (
										<span className="shrink-0 text-3xl font-bold text-pace-ok">+{finisher.points}p</span>
									)}
								</span>
								<span className="min-w-0 flex-1">
									<ArcRail rail={row.rail} size="tv" />
								</span>
								<span className="w-20 text-right text-3xl text-muted">
									{row.solved}/{row.total}
								</span>
								<span className="w-28 text-right text-4xl font-bold text-head">{row.score}p</span>
							</li>
						)
					})}
				</ol>
			))}
		</div>
	)
}
