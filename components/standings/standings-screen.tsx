"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { getStandings } from "@/app/standings/actions"
import { useGameClock } from "@/components/game/use-game-clock"
import type { PlayerStandings } from "@/lib/domain/player-game"
import { useLiveState } from "@/lib/events/use-live-state"
import { FinalSummary } from "./final-summary"
import { StandingsList } from "./standings-list"
import { TeamPace } from "./team-pace"

export function StandingsScreen({
	initial,
	channels,
	initialNow,
}: {
	initial: PlayerStandings
	channels: string[]
	initialNow: number
}) {
	const [standings, setStandings] = useLiveState(getStandings, channels, initial)
	const now = useGameClock(standings, initialNow, getStandings, setStandings)
	const router = useRouter()
	const unavailable = standings.lifecycleState === "waiting" || standings.lifecycleState === "countdown"
	useEffect(() => {
		if (unavailable) router.replace("/")
	}, [unavailable, router])
	if (!("rows" in standings)) return null
	return (
		<div className="mx-auto max-w-2xl">
			<header className="flex h-12 items-center gap-3 border-b border-z1 px-2">
				<Link
					href="/"
					className="inline-flex h-11 items-center px-2 font-cond text-link hover:text-head active:text-head focus-visible:outline-2 focus-visible:outline-accent"
				>
					{standings.lifecycleState === "running" ? "‹ Quest" : "‹ Back"}
				</Link>
				<h1 className="font-head font-medium text-head">Standings</h1>
			</header>
			<main className="px-4 pt-4 pb-8">
				{standings.lifecycleState === "running" ? (
					<TeamPace standings={standings} now={now} />
				) : (
					<FinalSummary standings={standings} />
				)}
				<StandingsList rows={standings.rows} finishers={standings.finishers} />
			</main>
		</div>
	)
}
