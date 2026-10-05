import type { Db } from "mongodb"
import type { Admin, Season, Team } from "@/lib/domain/schemas"
import { getDb } from "./client"

export class NotFoundError extends Error {
	name = "NotFoundError"
}

export function collectionsOf(db: Db) {
	return {
		seasons: db.collection<Season>("seasons"),
		teams: db.collection<Team>("teams"),
		admins: db.collection<Admin>("admins"),
	}
}

export async function collections() {
	return collectionsOf(await getDb())
}
