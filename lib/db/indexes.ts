import { type Db, MongoServerError } from "mongodb"

const absent = (error: unknown) =>
	error instanceof MongoServerError && ["IndexNotFound", "NamespaceNotFound"].includes(error.codeName ?? "")

export async function ensureIndexes(db: Db): Promise<void> {
	const teams = db.collection("teams")
	await teams.dropIndex("seasonId_1_name_1").catch((error) => {
		if (!absent(error)) throw error
	})
	await teams.createIndex(
		{ seasonId: 1, name: 1 },
		{ name: "season_name_ci", unique: true, collation: { locale: "en", strength: 2 } },
	)
	await teams.createIndex({ name: 1 })
	await db.collection("admins").createIndex({ name: 1 }, { unique: true })
}
