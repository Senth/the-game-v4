import type { PlayerGame } from "@/lib/domain/player-game"
import { formatTimeLeft } from "./clock"

type LifecycleView = {
	sentence: string
	value:
		| {
				kind: "countdown"
				date: Date
				band: "under-24-hours" | "under-7-days" | "7-days-or-more"
				text: string | null
		  }
		| { kind: "score"; text: string }
		| null
	helper: string | null
}

export function lifecycleView(game: Exclude<PlayerGame, { lifecycleState: "running" }>, now: Date): LifecycleView {
	switch (game.lifecycleState) {
		case "waiting":
			return { sentence: "The game hasn't been scheduled yet.", value: null, helper: "This page updates by itself." }
		case "countdown": {
			const distance = game.start.getTime() - now.getTime()
			if (distance <= 0) return { sentence: "The game is starting…", value: null, helper: null }
			const day = 24 * 60 * 60 * 1000
			return {
				sentence: distance < day ? "The game starts in" : "The game starts",
				value: {
					kind: "countdown",
					date: game.start,
					band: distance < day ? "under-24-hours" : distance < 7 * day ? "under-7-days" : "7-days-or-more",
					text: distance < day ? formatTimeLeft(distance) : null,
				},
				helper: null,
			}
		}
		case "completed":
			return { sentence: "You solved every quest.", value: { kind: "score", text: `${game.score}p` }, helper: null }
		case "ended":
			return { sentence: "Time's up.", value: { kind: "score", text: `${game.score}p` }, helper: null }
	}
}
