import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"

const FIRST_PORT = 7000
const PORT_COUNT = 1000

export type DevStack = { web: number; mongo?: number; pid: number }

function registryDir() {
	return path.resolve(process.env.DEV_STACK_REGISTRY ?? path.join(os.homedir(), ".local/state/dev-ports"))
}

function stackFile() {
	return path.join(process.cwd(), ".tmp/dev-stack/stack.json")
}

function worktreeRoot() {
	return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim()
}

export function scanStart(root: string) {
	return FIRST_PORT + (createHash("sha256").update(root).digest().readUInt32BE(0) % PORT_COUNT)
}

function listenFree(port: number, host: string) {
	return new Promise<boolean | undefined>((resolve) => {
		const probe = net.createServer()
		probe.once("error", (error: NodeJS.ErrnoException) =>
			resolve(error.code === "EAFNOSUPPORT" || error.code === "EADDRNOTAVAIL" ? undefined : false),
		)
		probe.once("listening", () => probe.close(() => resolve(true)))
		probe.listen(port, host)
	})
}

async function portFree(port: number) {
	return (await listenFree(port, "::")) ?? (await listenFree(port, "0.0.0.0")) ?? false
}

function claimPid(dir: string) {
	try {
		return Number.parseInt(fs.readFileSync(path.join(dir, "pid"), "utf8"), 10)
	} catch {
		return 0
	}
}

function pidAlive(pid: number) {
	if (!Number.isInteger(pid) || pid <= 0) return false
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM"
	}
}

async function claimPort(port: number, pid: number, root: string) {
	if (!(await portFree(port))) return false
	const dir = path.join(registryDir(), String(port))
	try {
		fs.mkdirSync(dir)
	} catch {
		if (pidAlive(claimPid(dir))) return false
		fs.rmSync(dir, { recursive: true, force: true })
		try {
			fs.mkdirSync(dir)
		} catch {
			return false
		}
	}
	fs.writeFileSync(path.join(dir, "pid"), String(pid))
	fs.writeFileSync(path.join(dir, "worktree"), root)
	return true
}

export async function allocPorts(names: string[], pid: number, root = worktreeRoot()) {
	fs.mkdirSync(registryDir(), { recursive: true })
	const pending = [...names]
	const ports: Record<string, number> = {}
	const offset = scanStart(root) - FIRST_PORT
	for (let i = 0; i < PORT_COUNT && pending.length > 0; i++) {
		const port = FIRST_PORT + ((offset + i) % PORT_COUNT)
		if (await claimPort(port, pid, root)) ports[pending.shift() as string] = port
	}
	if (pending.length > 0) {
		releasePorts(ports, pid)
		throw new Error(`no free ports in ${FIRST_PORT}-${FIRST_PORT + PORT_COUNT - 1} for: ${pending.join(" ")}`)
	}
	return ports
}

export function releasePorts(ports: Record<string, number>, pid: number) {
	for (const port of Object.values(ports)) {
		const dir = path.join(registryDir(), String(port))
		if (claimPid(dir) === pid) fs.rmSync(dir, { recursive: true, force: true })
	}
}

export function writeStack(state: DevStack) {
	fs.mkdirSync(path.dirname(stackFile()), { recursive: true })
	fs.writeFileSync(stackFile(), JSON.stringify(state))
}

export function readStack(): DevStack | undefined {
	let state: DevStack
	try {
		state = JSON.parse(fs.readFileSync(stackFile(), "utf8"))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
		throw error
	}
	return pidAlive(state.pid) ? state : undefined
}
