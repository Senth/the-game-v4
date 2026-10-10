"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { getGame, revealHint, submitAnswer } from "@/app/actions"
import { paceFromCounts, paceLabel } from "@/lib/domain/game"
import type { PlayerGame } from "@/lib/domain/player-game"
import { useLiveState } from "@/lib/events/use-live-state"
import { AnswerDock, type AnswerFeedback } from "./answer-dock"
import { endRefreshDelay } from "./end-refresh"
import { GameHeader } from "./game-header"
import { gamePlaceholder, gameTransitions } from "./game-transitions"
import { Intel } from "./intel"
import { QuestContent } from "./quest-content"

export function GameScreen({
	initial,
	channels,
	initialNow,
}: {
	initial: PlayerGame
	channels: string[]
	initialNow: number
}) {
	const [game, setGame] = useLiveState(getGame, channels, initial)
	const [previous, setPrevious] = useState(initial)
	const [now, setNow] = useState(() => new Date(initialNow))
	const [answer, setAnswer] = useState("")
	const [feedback, setFeedback] = useState<(AnswerFeedback & { questId: string }) | null>(null)
	const [decrypting, setDecrypting] = useState(() => new Set<string>())
	const [pending, startTransition] = useTransition()
	const clockStartedAt = useRef(0)

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

	useEffect(() => {
		clockStartedAt.current = performance.now()
		const timer = setInterval(() => setNow(new Date(initialNow + performance.now() - clockStartedAt.current)), 1000)
		return () => clearInterval(timer)
	}, [initialNow])
	const end = game.lifecycleState === "running" ? (game.end?.getTime() ?? null) : null
	useEffect(() => {
		if (end === null) return
		let cancelled = false
		let attempt = 0
		let timer: ReturnType<typeof setTimeout>
		const schedule = () => {
			const currentNow = initialNow + performance.now() - clockStartedAt.current
			timer = setTimeout(
				() => {
					startTransition(async () => {
						try {
							const next = await getGame()
							if (cancelled) return
							setGame(next)
							if (next.lifecycleState !== "running" || next.end?.getTime() !== end) return
						} catch {}
						if (!cancelled) {
							attempt++
							schedule()
						}
					})
				},
				endRefreshDelay(end, currentNow, attempt),
			)
		}
		schedule()
		return () => {
			cancelled = true
			clearTimeout(timer)
		}
	}, [end, initialNow, setGame])

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

	if (game.lifecycleState !== "running")
		return (
			<main className="flex min-h-dvh items-center justify-center px-4 text-center">
				<p className="text-muted">{gamePlaceholder(game)}</p>
			</main>
		)
	const pace = paceFromCounts({ start: game.start, end: game.end, solved: game.solved, total: game.total, now })
	return (
		<>
			<GameHeader
				timeLeftMs={end === null ? 0 : Math.max(0, end - now.getTime())}
				pace={pace && { band: pace.band, label: paceLabel(pace.n) }}
				rail={game.rail}
				strip={game.strip}
			/>
			<main className="mx-auto max-w-2xl px-4 pt-5 pb-[calc(var(--spacing)*40+env(safe-area-inset-bottom))]">
				{game.quest ? (
					<>
						<QuestContent quest={game.quest} />
						<Intel quest={game.quest} onReveal={reveal} decrypting={decrypting} onDecryptComplete={finishScramble} />
					</>
				) : (
					<p className="text-muted">Waiting for a quest.</p>
				)}
			</main>
			{game.quest && (
				<AnswerDock
					answer={answer}
					onAnswerChange={setAnswer}
					onSubmit={submit}
					pending={pending}
					feedback={feedback}
				/>
			)}
		</>
	)
}
