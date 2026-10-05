import { spawn } from "node:child_process"
import { loadEnvConfig } from "@next/env"
import { closeDb, getDb } from "@/lib/db/client"
import { startDevMongo } from "./mongo-dev"
import { isEmpty, seed } from "./seed"

async function main() {
	loadEnvConfig(process.cwd(), true)
	let mongo: Awaited<ReturnType<typeof startDevMongo>> | undefined
	if (!process.env.MONGODB_URI) {
		mongo = await startDevMongo()
		process.env.MONGODB_URI = mongo.uri
		try {
			const db = await getDb()
			if (await isEmpty(db)) console.log(await seed(db, new Date()))
		} catch (error) {
			await mongo.stop()
			throw error
		} finally {
			await closeDb()
		}
	}

	const next = spawn("next", ["dev", ...process.argv.slice(2)], { stdio: "inherit" })
	for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => next.kill(signal))
	next.on("exit", async (code) => {
		await mongo?.stop()
		process.exit(code ?? 1)
	})
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
