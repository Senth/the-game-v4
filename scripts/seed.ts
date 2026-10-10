import { copyFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { loadEnvConfig } from "@next/env"
import type { Db } from "mongodb"
import { hashPassword } from "@/lib/auth/password"
import { closeDb, getDb } from "@/lib/db/client"
import { collectionsOf } from "@/lib/db/collections"
import { ensureIndexes } from "@/lib/db/indexes"
import { allocPorts, type DevStack, readStack, releasePorts } from "./dev-ports"
import { backwardsLogAsset, buildFixture } from "./fixture"
import { mongoUri, startDevMongo } from "./mongo-dev"

const localHosts = ["localhost", "127.0.0.1"]

export function assertSeedTarget(uri: string, nodeEnv: string | undefined, force: boolean): void {
	if (force) return
	if (nodeEnv === "production") throw new Error("Refusing to seed with NODE_ENV=production. Pass --force to override.")
	const hosts = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/)?.[1]?.split(",") ?? []
	if (hosts.length === 0 || hosts.some((host) => !localHosts.includes(host.replace(/:\d+$/, "")))) {
		throw new Error(`Refusing to seed non-local MongoDB ${hosts.join(",")}. Pass --force to override.`)
	}
}

export async function isEmpty(db: Db): Promise<boolean> {
	const counts = await Promise.all(Object.values(collectionsOf(db)).map((collection) => collection.countDocuments()))
	return counts.every((count) => count === 0)
}

export async function seed(db: Db, now: Date): Promise<string> {
	const fixture = buildFixture(now)
	const teams = await Promise.all(
		fixture.teams.map(async ({ password, ...team }) => ({ ...team, passwordHash: await hashPassword(password) })),
	)
	const admins = await Promise.all(
		fixture.admins.map(async ({ password, ...admin }) => ({ ...admin, passwordHash: await hashPassword(password) })),
	)
	await db.dropDatabase()
	await ensureIndexes(db)
	const collections = collectionsOf(db)
	await collections.seasons.insertOne(fixture.season)
	await collections.teams.insertMany(teams)
	await collections.admins.insertMany(admins)

	const assetsDir = process.env.ASSETS_DIR ?? ".tmp/assets"
	await mkdir(assetsDir, { recursive: true })
	await copyFile("scripts/fixture/backwards-log.png", path.join(assetsDir, path.basename(backwardsLogAsset)))

	return `Seeded "${fixture.season.title}" into ${db.databaseName}: 1 season, ${teams.length} teams, ${admins.length} admin`
}

export function seedUri(envUri: string | undefined, stack: DevStack | undefined): string | undefined {
	return envUri ?? (stack?.mongo ? mongoUri(stack.mongo) : undefined)
}

async function main() {
	loadEnvConfig(process.cwd(), true)
	const known = seedUri(process.env.MONGODB_URI, readStack())
	const ports: Record<string, number> = known ? {} : await allocPorts(["mongo"], process.pid)
	let mongo: Awaited<ReturnType<typeof startDevMongo>> | undefined
	try {
		const uri = known ?? mongoUri(ports.mongo as number)
		assertSeedTarget(uri, process.env.NODE_ENV, process.argv.includes("--force"))
		if (ports.mongo) mongo = await startDevMongo(ports.mongo)
		process.env.MONGODB_URI = uri
		console.log(await seed(await getDb(), new Date()))
	} finally {
		await closeDb()
		await mongo?.stop()
		await releasePorts(ports, process.pid)
	}
}

if (import.meta.filename === process.argv[1]) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error)
		process.exit(1)
	})
}
