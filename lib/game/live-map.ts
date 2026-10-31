import { listPhonesForTeams } from "@/lib/db/phones"
import { getSeason } from "@/lib/db/seasons"
import { listTeams } from "@/lib/db/teams"
import { seasonStatus } from "@/lib/domain/admin-seasons"
import { type LivePlace, livePlaces } from "@/lib/domain/live-map"
import type { Season } from "@/lib/domain/schemas"
import { fixesForTeams } from "./location-fixes"

export type LivePhones =
	| { live: false }
	| {
			live: true
			mapArea: Season["mapArea"]
			teams: { id: string; name: string }[]
			places: LivePlace[]
			phones: {
				id: string
				teamId: string
				name: string
				lat: number
				lng: number
				accuracy: number
				expiresInMs: number
			}[]
	  }

export async function loadLivePhones(seasonId: string, now = new Date()): Promise<LivePhones> {
	const season = await getSeason(seasonId)
	if (!season || seasonStatus(season, now) !== "live") return { live: false }
	const teams = (await listTeams(seasonId)).sort((a, b) => a.name.localeCompare(b.name, "en"))
	const ids = teams.map(({ _id }) => _id)
	const records = new Map(
		(await listPhonesForTeams(ids)).map((phone) => [JSON.stringify([phone.teamId, phone.phoneId]), phone]),
	)
	return {
		live: true,
		mapArea: season.mapArea ? { lat: season.mapArea.lat, lng: season.mapArea.lng, zoom: season.mapArea.zoom } : null,
		teams: teams.map(({ _id, name }) => ({ id: _id, name })),
		places: livePlaces(season, teams),
		phones: fixesForTeams(ids, now.getTime()).flatMap(({ teamId, phoneId, fix, expiresInMs }) => {
			const phone = records.get(JSON.stringify([teamId, phoneId]))
			return phone
				? [{ id: phone._id, teamId, name: phone.name, lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, expiresInMs }]
				: []
		}),
	}
}
