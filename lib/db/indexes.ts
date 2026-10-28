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
	const nameIndex = (await teams.indexes()).find((index) => index.name === "name_1")
	if (nameIndex && (nameIndex.collation?.locale !== "en" || nameIndex.collation.strength !== 2)) {
		await teams.dropIndex("name_1")
	}
	await teams.createIndex({ name: 1 }, { collation: { locale: "en", strength: 2 } })
	await db.collection("admins").createIndex({ name: 1 }, { unique: true })
	const phones = db.collection("phones")
	await phones.createIndex({ teamId: 1, phoneId: 1 }, { unique: true })
	await phones.createIndex({ teamId: 1, name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } })
}
