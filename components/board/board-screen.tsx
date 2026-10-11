"use client"

import { useCallback } from "react"
import { getBoard } from "@/app/board/actions"
import { useGameClock } from "@/components/game/use-game-clock"
import type { PublicBoard } from "@/lib/domain/player-game"
import { useLiveState } from "@/lib/events/use-live-state"
import { BoardList } from "./board-list"
import { BoardStage } from "./board-stage"
import { BoardTime } from "./board-time"

function boardClock(board: PublicBoard) {
	const end = board.view === "running" ? board.end : null
	return {
		board,
		...(board.nextStart && (!end || board.nextStart < end)
			? { lifecycleState: "countdown" as const, start: board.nextStart }
			: board.view === "running"
				? { lifecycleState: "running" as const, end }
				: { lifecycleState: "waiting" as const }),
	}
}

const fetchClock = async () => boardClock(await getBoard())

export function BoardScreen({
	initial,
	channels,
	initialNow,
}: {
	initial: PublicBoard
	channels: string[]
	initialNow: number
}) {
	const [board, setBoard] = useLiveState(getBoard, channels, initial)
	const setClock = useCallback((next: ReturnType<typeof boardClock>) => setBoard(next.board), [setBoard])
	const now = useGameClock(boardClock(board), initialNow, fetchClock, setClock)
	return (
		<BoardStage>
			{board.view === "idle" ? (
				<main className="flex h-full items-center justify-center">
					<p className="font-cond text-4xl text-muted">No game running</p>
				</main>
			) : (
				<main className="flex h-full flex-col px-20 pt-10 pb-10">
					<div className="flex min-h-0 flex-1 flex-col">
						<h1 className="mb-4 shrink-0 font-cond text-[28px] text-muted uppercase tracking-wider">{board.title}</h1>
						<BoardList rows={board.rows} />
					</div>
					<div className="shrink-0">
						{board.view === "running" ? (
							<BoardTime start={board.start} end={board.end} now={now} />
						) : (
							<p className="font-cond text-5xl font-bold text-head">Final</p>
						)}
					</div>
				</main>
			)}
		</BoardStage>
	)
}
