import { createInterface } from "node:readline/promises"
import { Writable } from "node:stream"
import { loadEnvConfig } from "@next/env"
import { MongoServerError } from "mongodb"
import { hashPassword } from "@/lib/auth/password"
import { createAdmin } from "@/lib/db/admins"
import { closeDb } from "@/lib/db/client"
import type { Admin } from "@/lib/domain/schemas"

export async function createAdminAccount(name: string, password: string): Promise<Admin> {
	if (password.length < 8) throw new Error("Password must be at least 8 characters")
	try {
		return await createAdmin({ name, passwordHash: await hashPassword(password) })
	} catch (error) {
		if (error instanceof MongoServerError && error.code === 11000) throw new Error(`Admin "${name}" already exists`)
		throw error
	}
}

async function askHidden(question: string): Promise<string> {
	process.stdout.write(question)
	const muted = new Writable({ write: (_chunk, _encoding, callback) => callback() })
	const rl = createInterface({ input: process.stdin, output: muted, terminal: true })
	const answer = await rl.question("")
	rl.close()
	process.stdout.write("\n")
	return answer
}

async function readPassword(): Promise<string> {
	if (!process.stdin.isTTY) {
		for await (const line of createInterface({ input: process.stdin })) return line
		return ""
	}
	const password = await askHidden("Password: ")
	if (password !== (await askHidden("Repeat password: "))) throw new Error("Passwords do not match")
	return password
}

async function main() {
	loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production")
	const name = process.argv[2]?.trim()
	if (!name) throw new Error("Usage: pnpm admin:create <name>")
	if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set")
	try {
		await createAdminAccount(name, await readPassword())
		console.log(`Created admin "${name}"`)
	} finally {
		await closeDb()
	}
}

if (import.meta.filename === process.argv[1]) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error)
		process.exit(1)
	})
}
