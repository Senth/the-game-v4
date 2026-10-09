import { z } from "zod"
import { RevealedHint, Team, TeamQuestProgress } from "@/lib/domain/schemas"
import { collections, NotFoundError } from "./collections"

type TeamField = Exclude<keyof Team, "_id">

const Solve = TeamQuestProgress.pick({ questId: true, solvedAt: true, pointsEarned: true }).required()

const CurrentQuest = z.object({ questIndex: Team.shape.questIndex, questId: TeamQuestProgress.shape.questId })
export type CurrentQuest = z.infer<typeof CurrentQuest>

const CurrentSolve = CurrentQuest.extend({
	orderLength: z.number().int().positive(),
	hintCount: z.number().int().min(0),
})
export type CurrentSolve = z.infer<typeof CurrentSolve>

export async function createTeam(input: Omit<Team, "_id"> & { _id?: string }): Promise<Team> {
	const team = Team.parse({ ...input, _id: input._id ?? crypto.randomUUID() })
	await (await collections()).teams.insertOne(team)
	return team
}

export async function getTeam(id: string): Promise<Team | null> {
	return (await collections()).teams.findOne({ _id: id })
}

export async function listTeams(seasonId: string | null): Promise<Team[]> {
	return (await collections()).teams.find({ seasonId }).toArray()
}

export async function listTeamsByName(name: string): Promise<Team[]> {
	return (await collections()).teams.find({ name }).toArray()
}

export async function setTeamField<F extends TeamField>(teamId: string, field: F, value: Team[F]): Promise<void> {
	const parsed = Team.shape[field].parse(value)
	const result = await (await collections()).teams.updateOne({ _id: teamId }, { $set: { [field]: parsed } })
	if (result.matchedCount === 0) throw new NotFoundError(`Team ${teamId} not found`)
}

async function ensureProgress(teamId: string, current: CurrentQuest): Promise<void> {
	const { teams } = await collections()
	const progress = { questId: current.questId, hintsRevealed: [], pointsEarned: 0 }
	await teams.updateOne(
		{ ...currentFilter(teamId, current), "progress.questId": { $ne: current.questId } },
		{ $push: { progress } },
	)
	if ((await teams.countDocuments({ _id: teamId })) === 0) throw new NotFoundError(`Team ${teamId} not found`)
}

function currentFilter(teamId: string, { questIndex, questId }: CurrentQuest) {
	return { _id: teamId, questIndex, [`questOrder.${questIndex}`]: questId }
}

export async function revealHint(teamId: string, current: CurrentQuest, snapshot: RevealedHint): Promise<boolean> {
	const parsed = RevealedHint.parse(snapshot)
	const expected = CurrentQuest.parse(current)
	await ensureProgress(teamId, expected)
	const result = await (await collections()).teams.updateOne(
		{
			...currentFilter(teamId, expected),
			progress: {
				$elemMatch: {
					questId: expected.questId,
					solvedAt: { $exists: false },
					"hintsRevealed.hintId": { $ne: parsed.hintId },
				},
			},
		},
		{ $push: { "progress.$.hintsRevealed": parsed } },
	)
	return result.modifiedCount === 1
}

export async function solveCurrentQuest(
	teamId: string,
	expected: CurrentSolve,
	solvedAt: Date,
	pointsEarned: number,
): Promise<boolean> {
	const current = CurrentSolve.parse(expected)
	const solve = Solve.parse({ questId: current.questId, solvedAt, pointsEarned })
	await ensureProgress(teamId, current)
	const result = await (await collections()).teams.updateOne(
		{
			...currentFilter(teamId, current),
			questOrder: { $size: current.orderLength },
			progress: {
				$elemMatch: {
					questId: current.questId,
					solvedAt: { $exists: false },
					hintsRevealed: { $size: current.hintCount },
				},
			},
		},
		{
			$set: {
				"progress.$.solvedAt": solve.solvedAt,
				"progress.$.pointsEarned": solve.pointsEarned,
				completed: current.questIndex + 1 === current.orderLength,
			},
			$inc: { score: solve.pointsEarned, questIndex: 1 },
		},
	)
	return result.modifiedCount === 1
}
