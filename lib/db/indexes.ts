import type { Db } from "mongodb"

export async function ensureIndexes(db: Db): Promise<void> {
	await db.collection("teams").createIndex({ seasonId: 1, name: 1 }, { unique: true })
	await db.collection("admins").createIndex({ name: 1 }, { unique: true })
}
