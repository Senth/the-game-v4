"use client"

import { GameView } from "@/components/game/game-view"
import { LifecycleScreen } from "@/components/game/lifecycle-screen"
import { playerGame } from "@/lib/domain/player-game"
import type { Season, Team } from "@/lib/domain/schemas"
import { usePuzzlePreviewAssets } from "./use-puzzle-preview-assets"
import { useSeasonClock } from "./use-season-clock"

export function TeamPreview({
	season,
	team,
	teams,
	now,
}: {
	season: Pick<Season, "start" | "end" | "arcs" | "finishers">
	team: Omit<Team, "passwordHash">
	teams: Omit<Team, "passwordHash">[]
	now: number
}) {
	const clock = useSeasonClock(now, season.start, season.end)
	const quest = season.arcs.flatMap((arc) => arc.quests).find((quest) => quest.id === team.questOrder[team.questIndex])
	const assets = usePuzzlePreviewAssets(quest)
	const game = playerGame(season, team, teams, new Date(clock), assets)
	const view =
		game.lifecycleState === "running" ? (
			<GameView {...game} timeLeftMs={game.end ? Math.max(0, game.end.getTime() - clock) : 0} preview="team" />
		) : (
			<LifecycleScreen game={game} now={new Date(clock)} preview />
		)
	return (
		<>
			<div className="flex items-center justify-between gap-3">
				<h2 className="font-cond text-xs uppercase tracking-wider text-muted">What {team.name} see now</h2>
				<span className="font-cond text-xs text-muted">live</span>
			</div>
			<div className="mx-auto mt-3 h-[700px] w-[327px] overflow-hidden rounded-[28px] border-4 border-z2">
				<div className="h-[844px] w-[390px] origin-top-left scale-[0.82] bg-z0">
					<div className="h-full overflow-y-auto">{view}</div>
				</div>
			</div>
		</>
	)
}
