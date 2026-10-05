import { z } from "zod"

const id = z.string().min(1)

export const Hint = z.object({
	id,
	text: z.string(),
	points: z.number(),
})
export type Hint = z.infer<typeof Hint>

export const Quest = z.object({
	id,
	displayTitle: z.string(),
	internalTitle: z.string(),
	content: z.string(),
	assetPath: z.string().nullable(),
	answers: z.array(z.string()),
	points: z.number().nullable(),
	adminNotes: z.string(),
	hints: z.array(Hint),
})
export type Quest = z.infer<typeof Quest>

export const Arc = z.object({
	id,
	title: z.string(),
	shuffleQuests: z.boolean(),
	quests: z.array(Quest),
})
export type Arc = z.infer<typeof Arc>

export const Season = z.object({
	_id: id,
	title: z.string(),
	lengthMinutes: z.number(),
	start: z.date().nullable(),
	end: z.date().nullable(),
	shuffleArcs: z.boolean(),
	arcs: z.array(Arc),
})
export type Season = z.infer<typeof Season>

export const HintInput = Hint.extend({ id: id.optional() })
export type HintInput = z.infer<typeof HintInput>

export const QuestInput = Quest.extend({ hints: z.array(HintInput) })
export type QuestInput = z.infer<typeof QuestInput>

export const ArcInput = Arc.extend({ quests: z.array(QuestInput) })
export type ArcInput = z.infer<typeof ArcInput>

export const SeasonInput = Season.extend({ arcs: z.array(ArcInput) })
export type SeasonInput = z.infer<typeof SeasonInput>

export const RevealedHint = z.object({
	hintId: id,
	text: z.string(),
	points: z.number(),
	revealedAt: z.date(),
})
export type RevealedHint = z.infer<typeof RevealedHint>

export const TeamQuestProgress = z.object({
	questId: id,
	solvedAt: z.date().optional(),
	hintsRevealed: z.array(RevealedHint),
	pointsEarned: z.number(),
})
export type TeamQuestProgress = z.infer<typeof TeamQuestProgress>

export const Team = z.object({
	_id: id,
	name: z.string().min(1),
	passwordHash: z.string().min(1),
	seasonId: id.nullable(),
	questOrder: z.array(id),
	questIndex: z.number().int().min(0),
	score: z.number(),
	completed: z.boolean(),
	progress: z.array(TeamQuestProgress),
})
export type Team = z.infer<typeof Team>

export const Admin = z.object({
	_id: id,
	name: z.string().min(1),
	passwordHash: z.string().min(1),
})
export type Admin = z.infer<typeof Admin>

export function withHintIds(season: SeasonInput): Season {
	return {
		...season,
		arcs: season.arcs.map((arc) => ({
			...arc,
			quests: arc.quests.map((quest) => ({
				...quest,
				hints: quest.hints.map((hint) => ({ ...hint, id: hint.id ?? crypto.randomUUID() })),
			})),
		})),
	}
}
