"use client"

import { type ReactNode, useCallback, useState, useTransition } from "react"
import { getGame, revealHint, submitAnswer } from "@/app/actions"
import { paceFromCounts, paceLabel } from "@/lib/domain/game"
import type { PlayerGame } from "@/lib/domain/player-game"
import { useLiveState } from "@/lib/events/use-live-state"
import type { AnswerFeedback } from "./answer-dock"
import { gameTransitions } from "./game-transitions"
import { GameView } from "./game-view"
import { LifecycleScreen } from "./lifecycle-screen"
import { useGameClock } from "./use-game-clock"

export function GameScreen({
	initial,
	channels,
	initialNow,
	qr,
}: {
	initial: PlayerGame
	channels: string[]
	initialNow: number
	qr?: ReactNode
}) {
	const [game, setGame] = useLiveState(getGame, channels, initial)
	const [previous, setPrevious] = useState(initial)
	const now = useGameClock(game, initialNow, getGame, setGame)
	const [answer, setAnswer] = useState("")
	const [feedback, setFeedback] = useState<(AnswerFeedback & { questId: string }) | null>(null)
	const [decrypting, setDecrypting] = useState(() => new Set<string>())
	const [pending, startTransition] = useTransition()

	if (previous !== game) {
		const changes = gameTransitions(previous, game)
		setPrevious(game)
		if (changes.questChanged) {
			setAnswer("")
			setDecrypting(new Set())
			if (!changes.solvedQuestId) setFeedback(null)
		} else if (changes.revealedHintIds.length) {
			setDecrypting(new Set([...decrypting, ...changes.revealedHintIds]))
		}
		if (changes.solvedQuestId && (feedback?.kind !== "correct" || feedback.questId !== changes.solvedQuestId)) {
			setFeedback({ id: (feedback?.id ?? 0) + 1, kind: "correct", points: null, questId: changes.solvedQuestId })
		}
	}

	const end = game.lifecycleState === "running" ? (game.end?.getTime() ?? null) : null

	const finishScramble = useCallback((hintId: string) => {
		setDecrypting((current) => {
			const next = new Set(current)
			next.delete(hintId)
			return next
		})
	}, [])

	function submit(value: string) {
		if (pending || game.lifecycleState !== "running" || !game.quest || !value.trim()) return
		const questId = game.quest.id
		startTransition(async () => {
			try {
				const result = await submitAnswer(questId, value)
				if (!result.ok) {
					if (result.reason === "invalid")
						setFeedback((current) => ({
							id: (current?.id ?? 0) + 1,
							kind: "error",
							message: "Answer must be at most 200 characters.",
							questId,
						}))
					else setGame(await getGame())
				} else if (result.correct) {
					setGame(result.game)
					setFeedback((current) => ({
						id: (current?.id ?? 0) + 1,
						kind: "correct",
						points: result.pointsEarned,
						questId,
					}))
				} else {
					setFeedback((current) => ({ id: (current?.id ?? 0) + 1, kind: "wrong", answer: value, questId }))
				}
			} catch {
				setFeedback((current) => ({
					id: (current?.id ?? 0) + 1,
					kind: "error",
					message: "Could not send. Try again.",
					questId,
				}))
			}
		})
	}

	function reveal(hintId: string): Promise<void> {
		return new Promise((resolve, reject) => {
			startTransition(async () => {
				try {
					const result = await revealHint(hintId)
					setGame(result.ok ? result.game : await getGame())
					resolve()
				} catch (error) {
					reject(error)
				}
			})
		})
	}

	if (game.lifecycleState !== "running") return <LifecycleScreen game={game} now={now} qr={qr} />
	const pace = paceFromCounts({ start: game.start, end: game.end, solved: game.solved, total: game.total, now })
	return (
		<GameView
			timeLeftMs={end === null ? 0 : Math.max(0, end - now.getTime())}
			pace={pace && { band: pace.band, label: paceLabel(pace.n) }}
			rail={game.rail}
			strip={game.strip}
			quest={game.quest}
			answer={answer}
			onAnswerChange={setAnswer}
			onSubmit={submit}
			pending={pending}
			feedback={feedback}
			onReveal={reveal}
			decrypting={decrypting}
			onDecryptComplete={finishScramble}
		/>
	)
}
