import type { ChildProcess } from "node:child_process"
import { once } from "node:events"
import { rm } from "node:fs/promises"
import type { MongoMemoryServer } from "mongodb-memory-server"
import { releasePorts } from "@/scripts/dev-ports"

export type E2eStack = {
	server?: ChildProcess
	mongo?: MongoMemoryServer
	ports?: Record<string, number>
	dbPath?: string
}

export default async function teardown(stack: E2eStack) {
	try {
		if (stack.server?.pid && stack.server.exitCode === null && stack.server.signalCode === null) {
			const exited = once(stack.server, "exit")
			stack.server.kill("SIGKILL")
			await exited
		}
	} finally {
		try {
			await stack.mongo?.stop()
		} finally {
			try {
				if (stack.ports) await releasePorts(stack.ports, process.pid)
			} finally {
				if (stack.dbPath) await rm(stack.dbPath, { recursive: true, force: true })
			}
		}
	}
}
