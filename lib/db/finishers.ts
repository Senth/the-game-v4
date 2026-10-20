import type { Finisher } from "@/lib/domain/schemas"
import { collections, NotFoundError } from "./collections"

export async function claimFinish(seasonId: string, teamId: string, at: Date): Promise<Finisher> {
	const { seasons, teams } = await collections()
	const finishers = { $ifNull: ["$finishers", []] }
	const size = { $size: finishers }
	const updated = await seasons.findOneAndUpdate(
		{ _id: seasonId, "finishers.teamId": { $ne: teamId } },
		[
			{
				$set: {
					finishers: {
						$concatArrays: [
							finishers,
							[
								{
									teamId: { $literal: teamId },
									place: { $add: [size, 1] },
									points: { $ifNull: [{ $arrayElemAt: [{ $ifNull: ["$finisherBonuses", []] }, size] }, 0] },
									at: { $literal: at },
								},
							],
						],
					},
				},
			},
		],
		{ returnDocument: "after" },
	)
	const season = updated ?? (await seasons.findOne({ _id: seasonId }))
	const entry = (season?.finishers ?? []).find((finisher) => finisher.teamId === teamId)
	if (!entry) throw new NotFoundError(`Season ${seasonId} not found`)
	await teams.updateOne(
		{ _id: teamId, seasonId, finisherBonusApplied: { $ne: true } },
		{ $inc: { score: entry.points }, $set: { finisherBonusApplied: true } },
	)
	return entry
}
