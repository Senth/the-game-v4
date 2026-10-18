import { type Db, MongoClient } from "mongodb"
import { ensureIndexes } from "./indexes"

const cache = globalThis as typeof globalThis & {
	theGameClient?: MongoClient
	theGameDb?: Promise<Db>
	theGameReadOnlyClient?: MongoClient
	theGameReadOnlyDb?: Promise<Db>
}

async function connect(readOnly = false): Promise<Db> {
	const uri = process.env.MONGODB_URI
	if (!uri) throw new Error("MONGODB_URI is not set")
	const client = new MongoClient(uri)
	if (readOnly) cache.theGameReadOnlyClient = client
	else cache.theGameClient = client
	const name = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/)?.[1]
	const db = client.db(name ? decodeURIComponent(name) : "the-game")
	try {
		if (!readOnly) await ensureIndexes(db)
	} catch (error) {
		if (readOnly) {
			if (cache.theGameReadOnlyClient === client) cache.theGameReadOnlyClient = undefined
		} else if (cache.theGameClient === client) cache.theGameClient = undefined
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

export function getDbWithoutIndexes(): Promise<Db> {
	cache.theGameReadOnlyDb ??= connect(true).catch((error) => {
		cache.theGameReadOnlyDb = undefined
		throw error
	})
	return cache.theGameReadOnlyDb
}

export async function closeDb(): Promise<void> {
	const client = cache.theGameClient
	const readOnlyClient = cache.theGameReadOnlyClient
	cache.theGameClient = undefined
	cache.theGameDb = undefined
	cache.theGameReadOnlyClient = undefined
	cache.theGameReadOnlyDb = undefined
	await Promise.all([client?.close(), readOnlyClient?.close()])
}
