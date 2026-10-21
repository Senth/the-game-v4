import { z } from "zod"
import { sortByArrival } from "@/lib/domain/finishers"
import { applyStructuralEdit, buildQuestOrder, type StructuralEdit } from "@/lib/domain/game"
import { playableArcs } from "@/lib/domain/playable-quests"
import { RevealedHint, type Season, Team, TeamQuestProgress } from "@/lib/domain/schemas"
import { publish, teamChannel } from "@/lib/events/bus"
import { collections, NotFoundError } from "./collections"
import { claimFinish } from "./finishers"
import { finishSeasonStructure, withSeasonStructure } from "./structural-writes"

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

export async function listTeams(seasonId: string): Promise<Team[]> {
	return (await collections()).teams.find({ seasonId }).toArray()
}

export async function listSeasonTeams(seasonId: string): Promise<Omit<Team, "passwordHash">[]> {
	return (await collections()).teams
		.find<Omit<Team, "passwordHash">>({ seasonId }, { projection: { passwordHash: 0 } })
		.toArray()
}

export async function deleteTeam(id: string): Promise<boolean> {
	return (await (await collections()).teams.deleteOne({ _id: id })).deletedCount === 1
}

export async function editSeasonTeamOrders(seasonId: string, edit: StructuralEdit): Promise<string[]> {
	const { teams } = await collections()
	const affected: string[] = []
	const completed: Omit<Team, "passwordHash">[] = []
	const now = new Date()
	try {
		for (const listed of await listSeasonTeams(seasonId)) {
			if (listed.completed && listed.finisherBonusApplied === false) completed.push(listed)
			let current: Omit<Team, "passwordHash"> | null = listed
			for (let attempt = 0; current && current.seasonId === seasonId; attempt++) {
				if (edit.kind === "addQuest" && current.questOrder.includes(edit.questId)) break
				const result = applyStructuralEdit([current], edit, Math.random, now)
				const changed = result.teams[0]
				if (!result.affected.length || !changed) break
				const written = await teams.updateOne(
					{
						_id: current._id,
						seasonId,
						questOrder: current.questOrder,
						questIndex: current.questIndex,
						completed: current.completed,
						progress: current.progress,
					},
					{
						$set: {
							questOrder: changed.questOrder,
							completed: changed.completed,
							progress: changed.progress,
							...(changed.reachedAt ? { reachedAt: changed.reachedAt } : {}),
							...(changed.completed && !current.completed ? { finisherBonusApplied: false } : {}),
						},
					},
				)
				if (written.matchedCount) {
					affected.push(current._id)
					if (changed.completed && !current.completed) completed.push(current)
					break
				}
				if (attempt === 3) throw new Error("Not saved, retry")
				current = await getTeam(current._id)
			}
		}
		if (completed.length) {
			const season = await (await collections()).seasons.findOne({ _id: seasonId })
			if (!season) throw new NotFoundError(`Season ${seasonId} not found`)
			for (const team of sortByArrival(completed, season)) {
				await claimFinish(seasonId, team._id, now)
				if (!affected.includes(team._id)) affected.push(team._id)
			}
		}
		return affected
	} finally {
		for (const teamId of affected) publish(teamChannel(teamId))
	}
}

export async function fillQuestOrders(
	season: Season,
	teams: readonly Team[],
	random: () => number = Math.random,
): Promise<boolean> {
	return withSeasonStructure(season._id, async () => {
		await finishSeasonStructure(season._id)
		const current = await (await collections()).seasons.findOne({ _id: season._id })
		if (!current || !playableArcs(current).some((arc) => arc.quests.length > 0)) return false
		const operations = teams
			.filter((team) => team.seasonId === season._id && team.questOrder.length === 0 && team.progress.length === 0)
			.map((team) => ({
				updateOne: {
					filter: { _id: team._id, seasonId: season._id, questOrder: { $size: 0 }, progress: { $size: 0 } },
					update: { $set: { questOrder: buildQuestOrder(current, random), reachedAt: new Date() } },
				},
			}))
		if (operations.length === 0) return false
		const result = await (await collections()).teams.bulkWrite(operations, { ordered: false })
		return result.matchedCount > 0
	})
}

export async function countTeams(seasonId: string): Promise<number> {
	return (await collections()).teams.countDocuments({ seasonId })
}

export async function listTeamsByName(name: string): Promise<Team[]> {
	return (await collections()).teams.find({ name }, { collation: { locale: "en", strength: 2 } }).toArray()
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
				...(current.questIndex + 1 === current.orderLength ? { finisherBonusApplied: false } : {}),
				reachedAt: solve.solvedAt,
			},
			$inc: { score: solve.pointsEarned, questIndex: 1 },
		},
	)
	return result.modifiedCount === 1
}
