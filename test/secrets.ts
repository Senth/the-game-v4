import type { Season } from "@/lib/domain/schemas"

export const secretAnswer = (questId: string) => `secret-answer-${questId}`

export function withSecrets(season: Season): Season {
	return {
		...season,
		arcs: season.arcs.map((arc) => ({
			...arc,
			quests: arc.quests.map((quest) => ({
				...quest,
				internalTitle: `secret-internal-${quest.id}`,
				adminNotes: `secret-note-${quest.id}`,
				answers: [secretAnswer(quest.id)],
				hints: quest.hints.map((hint) => ({ ...hint, text: `secret-hint-${hint.id}` })),
			})),
		})),
	}
}
