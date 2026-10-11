import { ordinal } from "@/lib/domain/game"
import type { PlayerStandings } from "@/lib/domain/player-game"

export function FinalSummary({
	standings,
}: {
	standings: Extract<PlayerStandings, { lifecycleState: "completed" | "ended" }>
}) {
	const { you } = standings
	return (
		<section className="mb-6 font-cond">
			<p className="mb-3 truncate text-xs text-muted uppercase tracking-wider">{you.name}</p>
			<div className="flex items-baseline justify-between gap-2">
				<p>{standings.lifecycleState === "completed" ? "You solved every quest." : "Time's up."}</p>
				<p className="shrink-0 text-2xl font-bold text-head">{you.score}p</p>
			</div>
			<p className="mt-1 text-xs text-muted">
				{ordinal(you.rank)} of {you.teamCount} · {you.solved} / {you.total} quests
			</p>
		</section>
	)
}
