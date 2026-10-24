"use client"

import { type ReactNode, useEffect, useRef } from "react"
import type { PlayerFinisher } from "@/lib/domain/finishers"
import type { PaceBand, PlayerQuest, RailArc, StripEntry } from "@/lib/domain/game"
import type { Spot } from "@/lib/domain/schemas"
import type { useFinisherNotices } from "@/lib/events/use-finisher-notices"
import { AnswerDock, type AnswerFeedback } from "./answer-dock"
import { FinishRibbon } from "./finish-ribbon"
import { GameHeader } from "./game-header"
import { Intel } from "./intel"
import { LocationDock } from "./location-dock"
import { QuestContent } from "./quest-content"
import type { useCompass } from "./use-compass"
import type { LocationStatus } from "./use-location-reporter"

type GameViewProps = {
	timeLeftMs: number
	pace: { band: PaceBand; label: string } | null
	rail: RailArc[]
	strip?: StripEntry[]
	finishers?: PlayerFinisher[]
	quest: PlayerQuest | null
	puzzleComplete?: number
	locationComplete?: number
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
			locationStatus?: LocationStatus
			compass?: ReturnType<typeof useCompass>
			onShareLocation?: () => void
	  }
)

export function GameView(props: GameViewProps) {
	const live = props.preview ? null : props
	const { timeLeftMs, pace, rail, strip, quest } = props
	const showDock = quest && (quest.location || quest.hasAnswers !== false) && props.puzzleComplete === undefined
	const main = useRef<HTMLElement>(null)
	const dock = useRef<HTMLDivElement>(null)
	const location = !!quest?.location
	useEffect(() => {
		const content = main.current
		const bar = dock.current?.firstElementChild
		if (!location || !content || !bar || typeof ResizeObserver === "undefined") return
		const observer = new ResizeObserver(([entry]) => {
			if (entry)
				content.style.paddingBottom = `calc(${entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height}px + var(--spacing) * 5)`
		})
		observer.observe(bar)
		return () => {
			observer.disconnect()
			content.style.removeProperty("padding-bottom")
		}
	}, [location])

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
				ref={main}
				className={`mx-auto max-w-2xl px-4 pt-5 ${location ? "pb-[calc(var(--spacing)*96+env(safe-area-inset-bottom))]" : showDock ? "pb-[calc(var(--spacing)*40+env(safe-area-inset-bottom))]" : "pb-16"}`}
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
			{showDock && (
				<div ref={dock}>
					{quest.location ? (
						live ? (
							<LocationDock
								{...live.locationStatus}
								compass={live.compass}
								onShare={live.onShareLocation}
								pointsEarned={props.locationComplete}
								hasAnswers={quest.hasAnswers === true}
								guidanceEnabled={quest.location.guidance === "warmer"}
								answer={live.answer}
								onAnswerChange={live.onAnswerChange}
								onSubmit={live.onSubmit}
								pending={live.pending}
								feedback={live.feedback}
							/>
						) : (
							<LocationDock preview hasAnswers={quest.hasAnswers === true} />
						)
					) : live ? (
						<AnswerDock
							answer={live.answer}
							onAnswerChange={live.onAnswerChange}
							onSubmit={live.onSubmit}
							pending={live.pending}
							feedback={live.feedback}
						/>
					) : (
						<AnswerDock preview />
					)}
				</div>
			)}
		</>
	)
}
