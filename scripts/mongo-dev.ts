import { mkdir } from "node:fs/promises"
import { MongoMemoryServer } from "mongodb-memory-server"

export const devMongoUri = "mongodb://127.0.0.1:27018/the-game"

export async function startDevMongo(): Promise<{ uri: string; stop: () => Promise<boolean> }> {
	const dbPath = ".tmp/mongo"
	await mkdir(dbPath, { recursive: true })
	const server = await MongoMemoryServer.create({
		instance: { ip: "127.0.0.1", port: 27018, dbPath, storageEngine: "wiredTiger" },
	})
	return { uri: devMongoUri, stop: () => server.stop() }
}
