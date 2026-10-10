import type { PlayerGame } from "@/lib/domain/player-game"

export function gameTransitions(previous: PlayerGame, next: PlayerGame) {
	const before = previous.lifecycleState === "running" ? previous.quest : null
	const after = next.lifecycleState === "running" ? next.quest : null
	const questChanged = before?.id !== after?.id
	const locked = new Set(before?.hints.filter((hint) => !hint.revealed).map((hint) => hint.id))
	return {
		questChanged,
		revealedHintIds:
			!questChanged && after
				? after.hints.filter((hint) => hint.revealed && locked.has(hint.id)).map((hint) => hint.id)
				: [],
		solvedQuestId:
			questChanged &&
			before &&
			next.lifecycleState === "running" &&
			next.rail.some((arc) =>
				arc.segments.some((segment) => segment.questId === before.id && segment.state === "solved"),
			)
				? before.id
				: null,
	}
}
