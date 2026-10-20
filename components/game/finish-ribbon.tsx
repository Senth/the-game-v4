import { FinishFlag } from "@/components/finish-flag"
import type { PlayerFinisher } from "@/lib/domain/finishers"
import { ordinal } from "@/lib/domain/game"

export function FinishRibbon({
	notice,
	nextBonus,
	closing,
	onDismiss,
	board = false,
}: {
	notice: PlayerFinisher
	nextBonus: { place: number; points: number } | null
	closing: boolean
	onDismiss: () => void
	board?: boolean
}) {
	const bonus = notice.points > 0
	return (
		<div className="finish-notice shrink-0" data-closing={closing}>
			<div className="overflow-hidden">
				<button
					type="button"
					onClick={onDismiss}
					className={`finish-notice-content block w-full text-left font-cond hover:bg-z1 focus-visible:outline-2 focus-visible:outline-link focus-visible:-outline-offset-2 active:bg-z2 ${
						board ? "mb-4 px-6 py-4" : "mx-auto max-w-2xl px-4 py-3"
					} ${bonus ? "border-l-4 border-pace-ok" : "text-muted"}`}
				>
					<span className={`flex items-center gap-2 ${board ? (bonus ? "text-4xl" : "text-3xl") : "text-base"}`}>
						<FinishFlag className={board ? "h-8 w-8" : "h-4 w-4"} />
						<span className={`min-w-0 flex-1 ${bonus ? "text-head" : "text-muted"}`}>
							{notice.name} finished {ordinal(notice.place)}
						</span>
						{bonus && <span className="shrink-0 font-bold text-pace-ok">+{notice.points}p</span>}
					</span>
					{bonus && (
						<span className={`mt-1 block text-muted ${board ? "pl-10 text-3xl" : "pl-6 text-sm"}`}>
							{nextBonus ? `${ordinal(nextBonus.place)} still open for +${nextBonus.points}p` : "No bonus left"}
						</span>
					)}
				</button>
			</div>
		</div>
	)
}
