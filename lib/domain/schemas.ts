import { z } from "zod"
import { defaultPlaceRadius } from "./location"

const id = z.string().min(1)

export const AnswerAddValue = z
	.string()
	.transform((value) => value.trim().normalize("NFC"))
	.pipe(z.string().min(1).max(200))

export const Hint = z.object({
	id,
	text: z.string(),
	points: z.number().int().min(0).max(10000),
})
export type Hint = z.infer<typeof Hint>

export const Puzzle = z.object({
	rows: z.number().int().min(2).max(7).default(4),
	cols: z.number().int().min(2).max(7).default(4),
	showFull: z.boolean().default(false),
})
export type Puzzle = z.infer<typeof Puzzle>

export const Place = z.object({
	id,
	lat: z.number().min(-90).max(90),
	lng: z.number().min(-180).max(180),
	radius: z.number().int().min(5).max(500),
})
export type Place = z.infer<typeof Place>

export const Location = z.object({
	guidance: z.literal("none"),
	places: z.array(Place).length(1),
})
export type Location = z.infer<typeof Location>

export const Spot = z.union([
	z.strictObject({ cell: z.number().int().min(0).max(48) }),
	z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
])
export type Spot = z.infer<typeof Spot>

export const PuzzleState = z
	.object({
		version: z.number().int().min(0),
		spots: z.array(Spot).min(4).max(49),
	})
	.refine(({ spots }) => {
		const cells = spots.flatMap((spot) => ("cell" in spot ? [spot.cell] : []))
		return cells.every((cell) => cell < spots.length) && new Set(cells).size === cells.length
	}, "Puzzle cells must be unique and within the board")
export type PuzzleState = z.infer<typeof PuzzleState>

export const Quest = z.object({
	id,
	hidden: z.boolean().optional(),
	displayTitle: z.string(),
	internalTitle: z.string(),
	content: z.string(),
	assetPath: z.string().nullable(),
	puzzle: Puzzle.nullable().default(null).optional(),
	location: Location.nullable().default(null).optional(),
	answers: z.array(z.string()),
	points: z.number().int().min(0).max(10000).nullable(),
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

export const Finisher = z.object({
	teamId: id,
	place: z.number().int().positive(),
	points: z.number().int().min(0).max(10000),
	at: z.date(),
})
export type Finisher = z.infer<typeof Finisher>

export const Season = z.object({
	_id: id,
	title: z.string(),
	lengthMinutes: z.number().int().min(1).max(1440),
	defaultQuestPoints: z.number().int().min(0).max(10000).nullable().default(null),
	placeRadius: z.number().int().min(5).max(500).default(defaultPlaceRadius).optional(),
	start: z.date().nullable(),
	end: z.date().nullable(),
	shuffleArcs: z.boolean(),
	registrationOpen: z.boolean().default(false),
	finisherBonuses: z.array(z.number().int().min(0).max(10000)).default([]),
	finishers: z.array(Finisher).default([]),
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
export type SeasonInput = z.input<typeof SeasonInput>

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
	puzzle: PuzzleState.optional(),
})
export type TeamQuestProgress = z.infer<typeof TeamQuestProgress>

export const Team = z.object({
	_id: id,
	name: z.string().min(1),
	passwordHash: z.string().min(1),
	seasonId: id,
	questOrder: z.array(id),
	questIndex: z.number().int().min(0),
	reachedAt: z.date().optional(),
	// Missing is legacy; false is pending, true is set atomically with the score award.
	finisherBonusApplied: z.boolean().optional(),
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
	return Season.parse({
		...season,
		arcs: season.arcs.map((arc) => ({
			...arc,
			quests: arc.quests.map((quest) => ({
				...quest,
				hints: quest.hints.map((hint) => ({ ...hint, id: hint.id ?? crypto.randomUUID() })),
			})),
		})),
	})
}
