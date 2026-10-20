"use client"

import type { PlayerFinisher } from "@/lib/domain/finishers"
import type { PaceBand, PlayerQuest, RailArc, StripEntry } from "@/lib/domain/game"
import { AnswerDock, type AnswerFeedback } from "./answer-dock"
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
			/>
			<main className="mx-auto max-w-2xl px-4 pt-5 pb-[calc(var(--spacing)*40+env(safe-area-inset-bottom))]">
				{quest ? (
					<>
						<QuestContent quest={quest} preview={props.preview === "team"} />
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
