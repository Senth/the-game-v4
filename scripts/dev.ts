import { type ChildProcess, spawn } from "node:child_process"
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
	let allocating: ReturnType<typeof allocPorts> | undefined
	let booting: ReturnType<typeof startDevMongo> | undefined
	let next: ChildProcess | undefined
	let stopping: Promise<void> | undefined
	const stop = (code: number) => {
		stopping ??= (async () => {
			try {
				await (await booting?.catch(() => undefined))?.stop()
			} finally {
				releasePorts((await allocating?.catch(() => undefined)) ?? {}, process.pid)
				clearStack(process.pid)
			}
		})()
			.catch(console.error)
			.finally(() => process.exit(code))
		return stopping
	}
	for (const [signal, code] of [
		["SIGINT", 130],
		["SIGTERM", 143],
	] as const) {
		process.on(signal, () => (next ? next.kill(signal) : stop(code)))
	}

	try {
		allocating = allocPorts(names, process.pid)
		const ports = await allocating
		if (stopping) return
		if (ports.mongo) {
			booting = startDevMongo(ports.mongo)
			process.env.MONGODB_URI = (await booting).uri
			if (stopping) return
			try {
				const db = await getDb()
				if (await isEmpty(db)) console.log(await seed(db, new Date()))
			} finally {
				await closeDb()
			}
		}
		if (stopping) return
		const web = userPort ?? (ports.web as number)
		writeStack({ web, mongo: ports.mongo, pid: process.pid })
		next = spawn("next", ["dev", ...(ports.web ? ["-p", String(web)] : []), ...args], { stdio: "inherit" })
		next.on("error", (error) => {
			console.error(error)
			stop(1)
		})
		next.on("exit", (code) => stop(code ?? 1))
	} catch (error) {
		console.error(error)
		await stop(1)
	}
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
