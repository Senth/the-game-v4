import { Team } from "@/lib/domain/schemas"
import { collections, NotFoundError } from "./collections"

type TeamField = Exclude<keyof Team, "_id">

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

export async function setTeamField<F extends TeamField>(teamId: string, field: F, value: Team[F]): Promise<void> {
	const parsed = Team.shape[field].parse(value)
	const result = await (await collections()).teams.updateOne({ _id: teamId }, { $set: { [field]: parsed } })
	if (result.matchedCount === 0) throw new NotFoundError(`Team ${teamId} not found`)
}
