import Link from "next/link"
import type { QuestLiveStats } from "@/lib/domain/quest-stats"
import type { Hint } from "@/lib/domain/schemas"
import { outlineClass } from "./confirm-dialog"

export function QuestCompletion({
	stats,
	wide = false,
}: {
	stats: Pick<QuestLiveStats, "done" | "total">
	wide?: boolean
}) {
	return (
		<span className={wide ? "flex items-center gap-2" : "mt-1 flex items-center gap-2"}>
			<span aria-hidden="true" className={`h-1 ${wide ? "w-40" : "w-20"} overflow-hidden rounded-full bg-z2`}>
				<span
					className="block h-full bg-pace-ok"
					style={{ width: `${stats.total ? Math.min(100, (stats.done / stats.total) * 100) : 0}%` }}
				/>
			</span>
			<span className="font-cond text-xs text-muted tabular-nums">
				{stats.done}/{stats.total} done
			</span>
		</span>
	)
}

export function QuestLiveStatsBlock({
	stats,
	hints,
	editHref,
	variant,
}: {
	stats: QuestLiveStats
	hints: Hint[]
	editHref?: string
	variant?: "desktop"
}) {
	const desktop = variant === "desktop"
	return (
		<div className={`space-y-4 bg-z1/50 px-4 font-body ${desktop ? "mb-8 rounded-md py-4" : "pt-3 pb-4"}`}>
			{desktop && (
				<div className="flex items-center gap-3">
					<span className="font-cond text-xs uppercase tracking-wider text-muted">Live</span>
					<QuestCompletion stats={stats} wide />
				</div>
			)}
			<div>
				<p className="mb-1.5 font-cond text-xs uppercase tracking-wider text-muted">Completed by</p>
				{stats.completedBy.length ? (
					<div className="flex flex-wrap gap-1">
						{stats.completedBy.map((name) => (
							<span
								key={name}
								className="inline-flex h-6 items-center rounded bg-pace-ok/15 px-2 font-cond text-xs text-pace-ok"
							>
								{name}
							</span>
						))}
					</div>
				) : (
					<p className="font-cond text-xs text-muted">Nobody yet</p>
				)}
			</div>
			{hints.length > 0 && (
				<div>
					<p className="mb-1.5 font-cond text-xs uppercase tracking-wider text-muted">Hints</p>
					{hints.map((hint) => {
						const revealers = stats.hintRevealers[hint.id] ?? []
						return (
							<div key={hint.id} className="border-b border-z2/50 py-2 last:border-0">
								<div className="flex justify-between gap-3 text-sm">
									<span className="min-w-0 break-words">{hint.text}</span>
									<span className={`shrink-0 font-cond tabular-nums ${revealers.length ? "text-warn" : "text-muted"}`}>
										−{hint.points}p
									</span>
								</div>
								{revealers.length ? (
									<div className="mt-1.5 flex flex-wrap gap-1">
										{revealers.map((name) => (
											<span key={name} className="inline-flex h-6 items-center rounded bg-z2 px-2 font-cond text-xs">
												{name}
											</span>
										))}
									</div>
								) : (
									<p className="mt-1 font-cond text-xs text-muted">Not revealed yet</p>
								)}
							</div>
						)
					})}
				</div>
			)}
			{editHref && (
				<Link href={editHref} className={`${outlineClass} inline-flex items-center border-z2`}>
					Edit quest ›
				</Link>
			)}
		</div>
	)
}
