import Link from "next/link"
import type { StripEntry } from "@/lib/domain/game"

export function StandingsStrip({ strip }: { strip: StripEntry[] }) {
	return (
		<Link
			href="/standings"
			className="block min-h-11 bg-z1 hover:bg-z2/60 focus-visible:outline-2 focus-visible:outline-link focus-visible:-outline-offset-2 active:bg-z2"
		>
			<span className="mx-auto flex min-h-11 max-w-2xl items-center gap-1 overflow-hidden whitespace-nowrap px-2.5 font-cond text-[13px]">
				{strip.map((entry) =>
					entry.kind === "gap" ? (
						<span key="gap" className="shrink-0 text-muted">
							···
						</span>
					) : (
						<span
							key={entry.id}
							className={`flex min-w-0 items-baseline gap-1.5 px-1.5 ${entry.you ? "rounded bg-accent/20" : ""}`}
						>
							<span className="shrink-0 text-[11px] text-muted">{entry.rank}</span>
							<span className="truncate text-ink">{entry.name}</span>
							<span className="shrink-0 font-bold tabular-nums text-head">{entry.score}</span>
						</span>
					),
				)}
				<span className="ml-auto shrink-0 pl-2 text-link">All ›</span>
			</span>
		</Link>
	)
}
