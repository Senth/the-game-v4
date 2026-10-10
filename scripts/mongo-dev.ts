import { mkdir } from "node:fs/promises"
import { MongoMemoryServer } from "mongodb-memory-server"

export const mongoUri = (port: number) => `mongodb://127.0.0.1:${port}/the-game`

export async function startDevMongo(port: number): Promise<{ uri: string; stop: () => Promise<boolean> }> {
	const dbPath = ".tmp/mongo"
	await mkdir(dbPath, { recursive: true })
	const server = await MongoMemoryServer.create({
		instance: { ip: "127.0.0.1", port, portGeneration: false, dbPath, storageEngine: "wiredTiger" },
	})
	return { uri: mongoUri(port), stop: () => server.stop() }
}
