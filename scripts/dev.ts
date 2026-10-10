import { spawn } from "node:child_process"
import { loadEnvConfig } from "@next/env"
import { closeDb, getDb } from "@/lib/db/client"
import { allocPorts, clearStack, portArg, releasePorts, writeStack } from "./dev-ports"
import { startDevMongo } from "./mongo-dev"
import { isEmpty, seed } from "./seed"

async function main() {
	loadEnvConfig(process.cwd(), true)
	const args = process.argv.slice(2)
	const userPort = portArg(args)
	const names = [userPort === undefined && "web", !process.env.MONGODB_URI && "mongo"].filter((name) => name !== false)
	const ports = await allocPorts(names, process.pid)
	let mongo: Awaited<ReturnType<typeof startDevMongo>> | undefined
	const stop = async () => {
		await mongo?.stop()
		releasePorts(ports, process.pid)
		clearStack(process.pid)
	}

	try {
		if (ports.mongo) {
			mongo = await startDevMongo(ports.mongo)
			process.env.MONGODB_URI = mongo.uri
			try {
				const db = await getDb()
				if (await isEmpty(db)) console.log(await seed(db, new Date()))
			} finally {
				await closeDb()
			}
		}
	} catch (error) {
		await stop()
		throw error
	}

	const web = userPort ?? (ports.web as number)
	writeStack({ web, mongo: ports.mongo, pid: process.pid })
	const next = spawn("next", ["dev", ...(ports.web ? ["-p", String(web)] : []), ...args], { stdio: "inherit" })
	for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => next.kill(signal))
	next.on("exit", async (code) => {
		await stop()
		process.exit(code ?? 1)
	})
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
