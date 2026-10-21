import { spawn } from "node:child_process"
import { once } from "node:events"
import { existsSync } from "node:fs"
import { cp, mkdir, mkdtemp, open } from "node:fs/promises"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { MongoMemoryServer } from "mongodb-memory-server"
import { allocPorts } from "@/scripts/dev-ports"
import teardown, { type E2eStack } from "./global-teardown"

export default async function setup() {
	if (!existsSync(".next/standalone/server.js") || !existsSync(".next/standalone/scripts/admin-create.mjs"))
		throw new Error("run pnpm build first")
	const stack: E2eStack = {}
	try {
		await mkdir(".tmp/e2e/assets", { recursive: true })
		stack.dbPath = await mkdtemp(path.resolve(".tmp/e2e/mongo-"))
		stack.mongo = new MongoMemoryServer({ instance: { dbPath: stack.dbPath } })
		await stack.mongo.start()
		stack.ports = await allocPorts(["web"], process.pid)
		process.env.MONGODB_URI = stack.mongo.getUri()
		const seed = spawn(process.execPath, [".next/standalone/scripts/admin-create.mjs", "e2e-admin"], {
			stdio: ["pipe", "inherit", "inherit"],
		})
		seed.stdin.end("e2e-admin-pass\n")
		const [code] = await once(seed, "exit")
		if (code !== 0) throw new Error(`e2e admin creation exited with code ${code}`)
		await cp(".next/static", ".next/standalone/.next/static", { recursive: true })
		const log = await open(".tmp/e2e/server.log", "w")
		try {
			stack.server = spawn(process.execPath, [".next/standalone/server.js"], {
				env: {
					...process.env,
					PORT: String(stack.ports.web),
					HOSTNAME: "localhost",
					NODE_ENV: "production",
					SESSION_SECRET: "e2e-only-session-secret-32-chars",
					E2E_START_COUNTDOWN_MS: "1000",
					ASSETS_DIR: path.resolve(".tmp/e2e/assets"),
				},
				stdio: ["ignore", log.fd, log.fd],
			})
			await once(stack.server, "spawn")
		} finally {
			await log.close()
		}
		const baseURL = `http://localhost:${stack.ports.web}`
		const deadline = Date.now() + 10_000
		while (true) {
			if (stack.server.exitCode !== null || stack.server.signalCode !== null)
				throw new Error("e2e server exited; see .tmp/e2e/server.log")
			try {
				const response = await fetch(`${baseURL}/login`, { signal: AbortSignal.timeout(1000) })
				await response.body?.cancel()
				if (response.ok) break
			} catch {}
			if (Date.now() >= deadline) throw new Error("e2e server did not start; see .tmp/e2e/server.log")
			await sleep(100)
		}
		process.env.E2E_BASE_URL = baseURL
		return () => teardown(stack)
	} catch (error) {
		await teardown(stack)
		throw error
	}
}
