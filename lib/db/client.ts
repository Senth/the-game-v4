import { type Db, MongoClient } from "mongodb"
import { ensureIndexes } from "./indexes"

const cache = globalThis as typeof globalThis & { theGameClient?: MongoClient; theGameDb?: Promise<Db> }

async function connect(): Promise<Db> {
	const uri = process.env.MONGODB_URI
	if (!uri) throw new Error("MONGODB_URI is not set")
	const client = new MongoClient(uri)
	cache.theGameClient = client
	const name = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/)?.[1]
	const db = client.db(name ? decodeURIComponent(name) : "the-game")
	try {
		await ensureIndexes(db)
	} catch (error) {
		if (cache.theGameClient === client) cache.theGameClient = undefined
		await client.close()
		throw error
	}
	return db
}

export function getDb(): Promise<Db> {
	cache.theGameDb ??= connect().catch((error) => {
		cache.theGameDb = undefined
		throw error
	})
	return cache.theGameDb
}

export async function closeDb(): Promise<void> {
	const client = cache.theGameClient
	cache.theGameClient = undefined
	cache.theGameDb = undefined
	await client?.close()
}
