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
	return {
		board,
		...(board.view === "running"
			? { lifecycleState: "running" as const, end: board.end }
			: board.nextStart
				? { lifecycleState: "countdown" as const, start: board.nextStart }
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
			{board.view === "running" && (
				<main className="flex h-full flex-col px-20 pt-10 pb-10">
					<div className="flex-1">
						<h1 className="mb-4 font-cond text-[28px] text-muted uppercase tracking-wider">{board.title}</h1>
						<BoardList rows={board.rows} />
					</div>
					<BoardTime start={board.start} end={board.end} now={now} />
				</main>
			)}
		</BoardStage>
	)
}
