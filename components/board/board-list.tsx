import { ArcRail } from "@/components/game/arc-rail"
import type { StandingsRow } from "@/lib/domain/game"

export function BoardList({ rows }: { rows: StandingsRow[] }) {
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
					{column.map((row) => (
						<li key={row.id} className="flex min-h-0 items-center gap-x-8 border-b border-z1 font-cond">
							<span className="w-12 text-3xl text-muted">{row.rank}</span>
							<span className={`${twoColumns ? "w-[15rem]" : "w-[26rem]"} min-w-0 truncate text-4xl text-ink`}>
								{row.name}
							</span>
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
			))}
		</div>
	)
}
