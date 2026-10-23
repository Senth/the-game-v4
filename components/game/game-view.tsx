"use client"

import type { ReactNode } from "react"
import type { PlayerFinisher } from "@/lib/domain/finishers"
import type { PaceBand, PlayerQuest, RailArc, StripEntry } from "@/lib/domain/game"
import type { Spot } from "@/lib/domain/schemas"
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
	puzzleComplete?: number
} & (
	| { preview: true | "team" }
	| {
			preview?: false
			notices?: ReturnType<typeof useFinisherNotices>
			menu?: ReactNode
			nextBonus?: { place: number; points: number } | null
			answer: string
			onAnswerChange: (answer: string) => void
			onSubmit: (answer: string) => void
			pending: boolean
			feedback: AnswerFeedback | null
			onReveal: (hintId: string) => Promise<void>
			decrypting: ReadonlySet<string>
			onDecryptComplete: (hintId: string) => void
			onPuzzleDrop?: (pieceId: string, target: Spot) => Promise<void>
	  }
)

export function GameView(props: GameViewProps) {
	const live = props.preview ? null : props
	const { timeLeftMs, pace, rail, strip, quest } = props
	const showDock = quest && quest.hasAnswers !== false && props.puzzleComplete === undefined

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
				menu={live?.menu}
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
			<main
				className={`mx-auto max-w-2xl px-4 pt-5 ${showDock ? "pb-[calc(var(--spacing)*40+env(safe-area-inset-bottom))]" : "pb-16"}`}
			>
				{quest ? (
					<>
						<QuestContent
							quest={quest}
							preview={!!props.preview}
							onPuzzleDrop={live?.onPuzzleDrop}
							puzzleComplete={props.puzzleComplete}
						/>
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
			{showDock &&
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
