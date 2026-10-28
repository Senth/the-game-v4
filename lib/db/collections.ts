import type { Db } from "mongodb"
import type { Admin, Phone, Season, Team } from "@/lib/domain/schemas"
import { getDb } from "./client"
import type { PendingStructure } from "./structural-writes"

export class NotFoundError extends Error {
	name = "NotFoundError"
}

export function collectionsOf(db: Db) {
	return {
		seasons: db.collection<Season & { pendingStructure?: PendingStructure }>("seasons"),
		teams: db.collection<Team>("teams"),
		admins: db.collection<Admin>("admins"),
		phones: db.collection<Phone>("phones"),
	}
}

export async function collections() {
	return collectionsOf(await getDb())
}
