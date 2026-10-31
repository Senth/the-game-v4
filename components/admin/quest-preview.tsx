"use client"

import { useEffect, useRef, useState } from "react"
import { GameView } from "@/components/game/game-view"
import { previewGame } from "@/lib/domain/preview"
import type { Quest, Season } from "@/lib/domain/schemas"
import { useDraftHints, useDraftValue } from "./autosave-provider"
import { usePuzzlePreviewAssets } from "./use-puzzle-preview-assets"

export function QuestPreview({
	season,
	arcId,
	quest,
	now,
	frame = false,
}: {
	season: Pick<Season, "start" | "end" | "lengthMinutes" | "arcs">
	arcId: string
	quest: Quest
	now: number
	frame?: boolean
}) {
	const [previewClock, setPreviewClock] = useState({ initialNow: now, currentNow: now })
	useEffect(() => {
		const startedAt = performance.now()
		const timer = setInterval(() => {
			setPreviewClock({ initialNow: now, currentNow: now + performance.now() - startedAt })
		}, 1000)
		return () => clearInterval(timer)
	}, [now])
	const clock = previewClock.initialNow === now ? previewClock.currentNow : now
	const target = { arcId, questId: quest.id }
	const displayTitle = useDraftValue({ ...target, field: "displayTitle" }, quest.displayTitle)
	const content = useDraftValue({ ...target, field: "content" }, quest.content)
	const points = useDraftValue({ ...target, field: "points" }, quest.points)
	const drop = useDraftValue({ ...target, field: "drop" }, quest.drop ?? null)
	const assetPath = useDraftValue({ ...target, field: "assetPath" }, quest.assetPath)
	const hints = useDraftHints({ ...target, field: "hints" }, quest.hints)
	const puzzle = useDraftValue({ ...target, field: "puzzle" }, quest.puzzle)
	const location = useDraftValue({ ...target, field: "location" }, quest.location)
	const answers = useDraftValue({ ...target, field: "answers" }, quest.answers)
	const assets = usePuzzlePreviewAssets({ ...quest, assetPath, puzzle })
	const dropClock = useRef<{ drop: typeof drop; reachedAt: number }>({ drop, reachedAt: clock })
	if (dropClock.current.drop !== drop) dropClock.current = { drop, reachedAt: clock }
	const game = previewGame(
		season,
		{ ...quest, displayTitle, content, points, drop, assetPath, hints, puzzle, location, answers },
		new Date(clock),
		assets,
		new Date(dropClock.current.reachedAt),
	)
	const view = <GameView {...game} now={new Date(clock)} />
	if (!frame) return view
	return (
		<>
			<h2 className="font-cond text-xs uppercase tracking-wider text-muted">Player preview</h2>
			<div className="mt-3 h-[700px] w-[327px] overflow-hidden rounded-[28px] border-4 border-z2">
				<div className="h-[844px] w-[390px] origin-top-left scale-[0.82] bg-z0">
					<div className="h-full overflow-y-auto">{view}</div>
				</div>
			</div>
		</>
	)
}
