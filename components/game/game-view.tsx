"use client"

import type { PlayerFinisher } from "@/lib/domain/finishers"
import type { PaceBand, PlayerQuest, RailArc, StripEntry } from "@/lib/domain/game"
import type { useFinisherNotices } from "@/lib/events/use-finisher-notices"
import { AnswerDock, type AnswerFeedback } from "./answer-dock"
import { FinishRibbon } from "./finish-ribbon"
import { GameHeader } from "./game-header"
import { Intel } from "./intel"
import { QuestContent } from "./quest-content"

type GameViewProps = {
	timeLeftMs: number
	pace: { band: PaceBand; label: string } | null
	rail: RailArc[]
	strip?: StripEntry[]
	finishers?: PlayerFinisher[]
	quest: PlayerQuest | null
} & (
	| { preview: true | "team" }
	| {
			preview?: false
			notices?: ReturnType<typeof useFinisherNotices>
			nextBonus?: { place: number; points: number } | null
			answer: string
			onAnswerChange: (answer: string) => void
			onSubmit: (answer: string) => void
			pending: boolean
			feedback: AnswerFeedback | null
			onReveal: (hintId: string) => Promise<void>
			decrypting: ReadonlySet<string>
			onDecryptComplete: (hintId: string) => void
	  }
)

export function GameView(props: GameViewProps) {
	const live = props.preview ? null : props
	const { timeLeftMs, pace, rail, strip, quest } = props

	return (
		<>
			<GameHeader
				timeLeftMs={timeLeftMs}
				pace={props.preview === true ? null : pace}
				rail={rail}
				strip={props.preview === true ? undefined : strip}
				finishers={props.finishers}
				preview={props.preview === "team"}
				notices={live?.notices}
			/>
			<div aria-live="polite" aria-atomic="true">
				{live?.notices?.notice && live.notices.notice.points > 0 && (
					<FinishRibbon
						key={live.notices.notice.teamId}
						notice={live.notices.notice}
						nextBonus={live.nextBonus ?? null}
						closing={live.notices.closing}
						onDismiss={live.notices.dismiss}
					/>
				)}
			</div>
			<main className="mx-auto max-w-2xl px-4 pt-5 pb-[calc(var(--spacing)*40+env(safe-area-inset-bottom))]">
				{quest ? (
					<>
						<QuestContent quest={quest} preview={!!props.preview} />
						{live ? (
							<Intel
								quest={quest}
								onReveal={live.onReveal}
								decrypting={live.decrypting}
								onDecryptComplete={live.onDecryptComplete}
							/>
						) : (
							<Intel quest={quest} preview={props.preview === "team" ? "team" : true} />
						)}
					</>
				) : (
					<p className="text-muted">Waiting for a quest.</p>
				)}
			</main>
			{quest &&
				(live ? (
					<AnswerDock
						answer={live.answer}
						onAnswerChange={live.onAnswerChange}
						onSubmit={live.onSubmit}
						pending={live.pending}
						feedback={live.feedback}
					/>
				) : (
					<AnswerDock preview />
				))}
		</>
	)
}
