import type { Admin, Season, Team } from "@/lib/domain/schemas"
import { getDb } from "./client"

export class NotFoundError extends Error {
	name = "NotFoundError"
}

export async function collections() {
	const db = await getDb()
	return {
		seasons: db.collection<Season>("seasons"),
		teams: db.collection<Team>("teams"),
		admins: db.collection<Admin>("admins"),
	}
}
