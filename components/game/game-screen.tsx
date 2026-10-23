"use client"

import { useRouter } from "next/navigation"
import { type ReactNode, useCallback, useEffect, useState, useTransition } from "react"
import { dropPuzzlePiece, getGame, getSolvedLocation, getSolvedPuzzle, revealHint, submitAnswer } from "@/app/actions"
import { paceFromCounts, paceLabel } from "@/lib/domain/game"
import type { PlayerGame } from "@/lib/domain/player-game"
import type { Spot } from "@/lib/domain/schemas"
import { useFinisherNotices } from "@/lib/events/use-finisher-notices"
import { useLiveState } from "@/lib/events/use-live-state"
import type { AnswerFeedback } from "./answer-dock"
import { gameTransitions } from "./game-transitions"
import { GameView } from "./game-view"
import { LifecycleScreen } from "./lifecycle-screen"
import { TeamMenu } from "./team-menu"
import { useGameClock } from "./use-game-clock"
import { useLocationReporter } from "./use-location-reporter"

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
	const router = useRouter()
	const [game, setGame] = useLiveState(
		async () => {
			const next = await getGame()
			if (next.lifecycleState === "waiting" || next.lifecycleState === "countdown") router.refresh()
			return next
		},
		channels,
		initial,
	)
	const [previous, setPrevious] = useState(initial)
	const [completion, setCompletion] = useState<{
		game: Extract<PlayerGame, { lifecycleState: "running" }>
		solved?: { ids?: string[]; pointsEarned: number }
	} | null>(null)
	const now = useGameClock(game, initialNow, getGame, setGame)
	const [answer, setAnswer] = useState("")
	const [feedback, setFeedback] = useState<(AnswerFeedback & { questId: string }) | null>(null)
	const [decrypting, setDecrypting] = useState(() => new Set<string>())
	const [pending, startTransition] = useTransition()
	const notices = useFinisherNotices(
		game.lifecycleState === "running" ? game.finishers : undefined,
		game.lifecycleState === "running" ? game.start.toISOString() : "",
		"teamId" in game ? game.teamId : undefined,
	)
	const location = useLocationReporter(
		!completion && game.lifecycleState === "running" && game.quest?.location ? game.quest.id : null,
		() => {
			void getGame().then(setGame, () => {})
		},
	)

	if (previous !== game) {
		const changes = gameTransitions(previous, game)
		setPrevious(game)
		if (changes.questChanged) {
			if (
				previous.lifecycleState === "running" &&
				(previous.quest?.puzzle || previous.quest?.location) &&
				(game.lifecycleState === "running" || game.lifecycleState === "completed")
			) {
				setCompletion({ game: previous })
			}
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
	const completingGame = completion?.game
	useEffect(() => {
		if (!completingGame?.quest) return
		let cancelled = false
		let timer: ReturnType<typeof setTimeout> | undefined
		const solvedQuest = completingGame.quest.location ? getSolvedLocation : getSolvedPuzzle
		solvedQuest(completingGame.quest.id).then(
			(solved) => {
				if (cancelled) return
				if (!solved) {
					setCompletion(null)
					return
				}
				setCompletion({ game: completingGame, solved })
				timer = setTimeout(() => setCompletion(null), 1500)
			},
			() => {
				if (!cancelled) setCompletion(null)
			},
		)
		return () => {
			cancelled = true
			clearTimeout(timer)
		}
	}, [completingGame])

	const end = game.lifecycleState === "running" ? (game.end?.getTime() ?? null) : null

	const finishScramble = useCallback((hintId: string) => {
		setDecrypting((current) => {
			const next = new Set(current)
			next.delete(hintId)
			return next
		})
	}, [])

	function submit(value: string) {
		if (completion || pending || game.lifecycleState !== "running" || !game.quest || !value.trim()) return
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
	async function drop(pieceId: string, target: Spot) {
		if (game.lifecycleState !== "running" || !game.quest) throw new Error("No current puzzle")
		const result = await dropPuzzlePiece(game.quest.id, pieceId, target)
		setGame(await getGame())
		if (result.status === "stale") throw new Error("Puzzle drop rejected")
	}

	const shown = completingGame ?? game
	if (shown.lifecycleState !== "running") return <LifecycleScreen game={shown} now={now} qr={qr} />
	const quest = shown.quest
	const solvedQuest =
		completion?.solved?.ids && quest?.puzzle
			? {
					...quest,
					puzzle: { ...quest.puzzle, pieces: completion.solved.ids.map((id, cell) => ({ id, spot: { cell } })) },
				}
			: quest
	const teamName = shown.strip.flatMap((entry) => (entry.kind === "team" && entry.you ? [entry.name] : []))[0]
	const pace = paceFromCounts({ start: shown.start, end: shown.end, solved: shown.solved, total: shown.total, now })
	return (
		<GameView
			timeLeftMs={end === null ? 0 : Math.max(0, end - now.getTime())}
			pace={pace && { band: pace.band, label: paceLabel(pace.n) }}
			rail={shown.rail}
			strip={shown.strip}
			finishers={shown.finishers}
			notices={notices}
			menu={teamName && <TeamMenu teamName={teamName} />}
			nextBonus={shown.nextBonus}
			quest={solvedQuest}
			puzzleComplete={quest?.puzzle ? completion?.solved?.pointsEarned : undefined}
			locationComplete={quest?.location ? completion?.solved?.pointsEarned : undefined}
			locationStatus={location}
			onShareLocation={location.share}
			onPuzzleDrop={completion ? undefined : drop}
			answer={answer}
			onAnswerChange={setAnswer}
			onSubmit={submit}
			pending={pending || !!completion}
			feedback={feedback}
			onReveal={reveal}
			decrypting={decrypting}
			onDecryptComplete={finishScramble}
		/>
	)
}
