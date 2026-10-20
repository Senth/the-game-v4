import Link from "next/link"
import { FinishFlag } from "@/components/finish-flag"
import type { PlayerFinisher } from "@/lib/domain/finishers"
import type { StripEntry } from "@/lib/domain/game"
import { ordinal } from "@/lib/domain/game"

export function StandingsStrip({
	strip,
	finishers = [],
	preview = false,
	notice,
	closing = false,
	onDismiss,
}: {
	strip: StripEntry[]
	finishers?: PlayerFinisher[]
	preview?: boolean
	notice?: PlayerFinisher | null
	closing?: boolean
	onDismiss?: () => void
}) {
	const content = (
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
						{finishers.some((finisher) => finisher.teamId === entry.id) && (
							<FinishFlag className="h-3 w-3 self-center" />
						)}
						<span className="shrink-0 font-bold tabular-nums text-head">{entry.score}</span>
					</span>
				),
			)}
			<span className="ml-auto shrink-0 pl-2 text-link">All ›</span>
		</span>
	)
	if (preview) return <div className="block min-h-11 bg-z1">{content}</div>
	return (
		<div className="relative min-h-11 bg-z1">
			<Link
				href="/standings"
				tabIndex={notice ? -1 : undefined}
				aria-hidden={notice ? true : undefined}
				className={`block min-h-11 transition-opacity duration-250 hover:bg-z2/60 focus-visible:outline-2 focus-visible:outline-link focus-visible:-outline-offset-2 active:bg-z2 ${notice && !closing ? "opacity-0" : "opacity-100"}`}
			>
				{content}
			</Link>
			<span aria-live="polite" aria-atomic="true">
				{notice && (
					<button
						key={notice.teamId}
						type="button"
						onClick={onDismiss}
						className={`finish-strip-notice absolute inset-0 flex min-h-11 w-full items-center justify-center gap-2 bg-z1 px-4 text-left font-cond text-sm text-muted transition-opacity duration-250 hover:bg-z2/60 focus-visible:outline-2 focus-visible:outline-link focus-visible:-outline-offset-2 active:bg-z2 ${closing ? "pointer-events-none opacity-0" : "opacity-100"}`}
					>
						<FinishFlag className="h-4 w-4" />
						<span className="truncate">
							{notice.name} finished {ordinal(notice.place)}
						</span>
					</button>
				)}
			</span>
		</div>
	)
}
