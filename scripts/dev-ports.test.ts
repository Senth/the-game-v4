import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { allocPorts, portArg, readStack, releasePorts, scanStart, writeStack } from "./dev-ports"

const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid as number
const startOf = (pid: number) => fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ").pop()?.split(" ")[19]
const root = "/test/worktree"
let tmp: string

beforeEach(() => {
	tmp = path.resolve(`.tmp/test-dev-ports-${crypto.randomUUID()}`)
	vi.stubEnv("DEV_STACK_REGISTRY", path.join(tmp, "registry"))
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
	fs.rmSync(tmp, { recursive: true, force: true })
})

const claimDir = (port: number) => path.join(tmp, "registry", String(port))

function listen(port: number, host: string) {
	return new Promise<net.Server>((resolve, reject) => {
		const server = net.createServer()
		server.once("error", reject)
		server.listen(port, host, () => resolve(server))
	})
}

describe("allocPorts", () => {
	it("starts the scan at the same offset for the same root", () => {
		expect(scanStart(root)).toBe(scanStart(root))
		expect(scanStart(root)).toBeGreaterThanOrEqual(7000)
		expect(scanStart(root)).toBeLessThanOrEqual(7999)
	})

	it("never returns the same port twice and records the claim", async () => {
		const first = await allocPorts(["web", "mongo"], process.pid, root)
		const second = await allocPorts(["web", "mongo"], process.pid, root)
		const ports = [...Object.values(first), ...Object.values(second)]
		expect(new Set(ports).size).toBe(4)
		expect(fs.readFileSync(path.join(claimDir(first.web as number), "pid"), "utf8")).toBe(String(process.pid))
		expect(fs.readFileSync(path.join(claimDir(first.web as number), "worktree"), "utf8")).toBe(root)
	})

	it.each(["127.0.0.1", "::1"])("skips a port with a live listener on %s", async (host) => {
		const { web } = await allocPorts(["web"], process.pid, root)
		await releasePorts({ web: web as number }, process.pid)
		const server = await listen(web as number, host)
		try {
			expect((await allocPorts(["web"], process.pid, root)).web).not.toBe(web)
		} finally {
			server.close()
		}
	})

	it("reclaims a claim held by a dead pid", async () => {
		const { web } = await allocPorts(["web"], process.pid, root)
		fs.writeFileSync(path.join(claimDir(web as number), "pid"), String(deadPid()))
		expect((await allocPorts(["web"], process.pid, root)).web).toBe(web)
	})

	it("keeps a claim held by a live pid", async () => {
		const { web } = await allocPorts(["web"], process.pid, root)
		expect((await allocPorts(["web"], process.pid, root)).web).not.toBe(web)
		expect(fs.existsSync(claimDir(web as number))).toBe(true)
	})

	it("keeps a fresh claim that has no pid yet and reclaims a stale one", async () => {
		const { web } = await allocPorts(["web"], process.pid, root)
		fs.rmSync(path.join(claimDir(web as number), "pid"))
		expect((await allocPorts(["web"], process.pid, root)).web).not.toBe(web)
		expect(fs.existsSync(claimDir(web as number))).toBe(true)
		const old = new Date(Date.now() - 60_000)
		fs.utimesSync(claimDir(web as number), old, old)
		expect((await allocPorts(["web"], process.pid, root)).web).toBe(web)
	})

	it.each([
		[
			"finishes publishing a claim it created before pausing",
			(dir: string) => {
				fs.mkdirSync(dir, { recursive: true })
				const old = new Date(Date.now() - 60_000)
				fs.utimesSync(dir, old, old)
			},
		],
		[
			"replaces a dead claim",
			(dir: string) => {
				fs.mkdirSync(dir, { recursive: true })
				fs.writeFileSync(path.join(dir, "pid"), String(deadPid()))
			},
		],
	])("waits while another process holding the registry lock %s", async (_, prepare) => {
		const port = scanStart(root)
		const dir = claimDir(port)
		prepare(dir)
		const script = `Promise.all([import("node:fs"), import("./scripts/dev-ports.ts")]).then(([fs, { withLock }]) => withLock(() => {
			console.log("locked")
			fs.readSync(0, Buffer.alloc(1))
			fs.rmSync(${JSON.stringify(dir)}, { recursive: true, force: true })
			fs.mkdirSync(${JSON.stringify(dir)})
			fs.writeFileSync(${JSON.stringify(path.join(dir, "pid"))}, String(process.pid))
		})).then(() => process.stdin.resume())`
		const holder = spawn(process.execPath, ["-e", script])
		try {
			await new Promise((resolve) => holder.stdout.once("data", resolve))
			const allocating = allocPorts(["web"], process.pid, root)
			await new Promise((resolve) => setTimeout(resolve, 300))
			holder.stdin.write("g")
			expect((await allocating).web).not.toBe(port)
			expect(fs.readFileSync(path.join(dir, "pid"), "utf8")).toBe(String(holder.pid))
		} finally {
			holder.kill()
		}
	})

	it.each([
		["a dead holder", () => `${deadPid()} 1`],
		["a reused pid", () => `${process.pid} 1`],
		["a live holder past the stale limit", () => `${process.pid} ${startOf(process.pid)}`],
	])("breaks a registry lock left by %s", async (_, owner) => {
		const lock = path.join(tmp, "registry", ".lock")
		fs.mkdirSync(path.dirname(lock), { recursive: true })
		fs.writeFileSync(lock, owner())
		const old = new Date(Date.now() - 60_000)
		fs.utimesSync(lock, old, old)
		expect((await allocPorts(["web"], process.pid, root)).web).toBe(scanStart(root))
		expect(fs.existsSync(lock)).toBe(false)
	})

	it("hands distinct ports to concurrent processes", async () => {
		const script = `import("./scripts/dev-ports.ts").then(async ({ allocPorts }) => {
			console.log(JSON.stringify(Object.values(await allocPorts(["web", "mongo"], process.pid, ${JSON.stringify(root)}))))
			process.stdin.resume()
		})`
		const children = Array.from({ length: 6 }, () => spawn(process.execPath, ["-e", script]))
		try {
			const ports = await Promise.all(
				children.map(
					(child) =>
						new Promise<number[]>((resolve, reject) => {
							child.stdout.once("data", (data) => resolve(JSON.parse(String(data))))
							child.once("exit", (code) => reject(new Error(`allocator exited with ${code}`)))
						}),
				),
			)
			expect(new Set(ports.flat()).size).toBe(12)
		} finally {
			for (const child of children) child.kill()
		}
	})

	it("wraps the scan from 7999 to 7000", async () => {
		let wrapRoot = ""
		for (let i = 0; scanStart(wrapRoot) !== 7999; i++) wrapRoot = `/wrap/${i}`
		fs.mkdirSync(claimDir(7999), { recursive: true })
		fs.writeFileSync(path.join(claimDir(7999), "pid"), String(process.pid))
		const { web } = await allocPorts(["web"], process.pid, wrapRoot)
		expect(web).toBeGreaterThanOrEqual(7000)
		expect(web).toBeLessThan(7999)
	})
})

describe("releasePorts", () => {
	it("removes only claims owned by the given pid", async () => {
		const ports = await allocPorts(["web"], process.pid, root)
		await releasePorts(ports, deadPid())
		expect(fs.existsSync(claimDir(ports.web as number))).toBe(true)
		await releasePorts(ports, process.pid)
		expect(fs.existsSync(claimDir(ports.web as number))).toBe(false)
	})

	it("releases every other claim when one fails, then throws", async () => {
		const { web, mongo } = await allocPorts(["web", "mongo"], process.pid, root)
		const rm = fs.rmSync
		vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
			if (target === claimDir(web as number)) throw new Error("EBUSY")
			rm(target, options)
		})
		await expect(releasePorts({ web: web as number, mongo: mongo as number }, process.pid)).rejects.toThrow(
			AggregateError,
		)
		expect(fs.existsSync(claimDir(web as number))).toBe(true)
		expect(fs.existsSync(claimDir(mongo as number))).toBe(false)
	})
})

describe("stack state", () => {
	beforeEach(() => {
		vi.spyOn(process, "cwd").mockReturnValue(tmp)
	})

	it("returns undefined when the file is missing", () => {
		expect(readStack()).toBeUndefined()
	})

	it("round-trips a live stack and ignores a dead pid", () => {
		writeStack({ web: 7001, mongo: 7002, pid: process.pid, mongoPid: process.pid })
		expect(readStack()).toMatchObject({ web: 7001, mongo: 7002, pid: process.pid })
		writeStack({ web: 7001, pid: deadPid() })
		expect(readStack()).toBeUndefined()
	})

	it("ignores a live pid whose start time differs from the recorded one", () => {
		writeStack({ web: 7001, pid: process.pid })
		const file = path.join(tmp, ".tmp/dev-stack/stack.json")
		fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), start: "1" }))
		expect(readStack()).toBeUndefined()
	})

	it("drops the mongo port unless its mongod is alive with the recorded start time", () => {
		writeStack({ web: 7001, mongo: 7002, pid: process.pid, mongoPid: deadPid() })
		expect(readStack()).toMatchObject({ web: 7001, mongo: undefined })
		writeStack({ web: 7001, mongo: 7002, pid: process.pid, mongoPid: process.pid })
		const file = path.join(tmp, ".tmp/dev-stack/stack.json")
		fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), mongoStart: "1" }))
		expect(readStack()).toMatchObject({ web: 7001, mongo: undefined })
	})
})

describe("portArg", () => {
	it("reads -p, --port and --port=", () => {
		expect(portArg(["-p", "7100"])).toBe(7100)
		expect(portArg(["--turbo", "--port", "7101"])).toBe(7101)
		expect(portArg(["--port=7102"])).toBe(7102)
		expect(portArg(["--turbo"])).toBeUndefined()
	})
})
