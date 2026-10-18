import { writeFile } from "node:fs/promises"
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app"
import { type DocumentData, getFirestore, Timestamp } from "firebase-admin/firestore"

const usage = "Usage: pnpm export:v3 --project <gcp-id> [--collection game_seasons] --out <file>"

export function parseExportArgs(args: string[]) {
	const options = { collection: "game_seasons", output: "", projectId: "" }
	for (let index = 0; index < args.length; index += 1) {
		const option = args[index]
		const value = args[index + 1]
		if (!value || value.startsWith("--")) throw new Error(usage)
		if (option === "--project") options.projectId = value
		else if (option === "--collection") options.collection = value
		else if (option === "--out") options.output = value
		else throw new Error(usage)
		index += 1
	}
	if (!options.projectId || !options.output) throw new Error(usage)
	return options
}

function serializeValue(value: unknown): unknown {
	if (value instanceof Timestamp) {
		return { __datatype__: "timestamp", value: { _seconds: value.seconds } }
	}
	if (value instanceof Date) return value.toISOString()
	if (Array.isArray(value)) return value.map(serializeValue)
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeValue(item)]))
	}
	return value
}

export function serializeV3Documents(documents: { id: string; data: () => DocumentData }[]) {
	return Object.fromEntries(documents.map(({ id, data }) => [id, serializeValue(data())]))
}

async function main() {
	const { collection, output, projectId } = parseExportArgs(process.argv.slice(2))
	const app = initializeApp({ credential: applicationDefault(), projectId })
	try {
		const firestore = getFirestore(app)
		const snapshot = await firestore.collection(collection).get()
		if (snapshot.empty) {
			const names = (await firestore.listCollections()).map(({ id }) => id)
			console.error(`Collection "${collection}" is empty or missing. Root collections: ${names.join(", ") || "(none)"}`)
			process.exitCode = 1
			return
		}
		const documents = snapshot.docs.map((document) => ({ id: document.id, data: () => document.data() }))
		const result = { [collection]: serializeV3Documents(documents) }
		await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8")
		console.log(`Exported ${snapshot.size} documents from "${collection}" to ${output}`)
	} finally {
		await deleteApp(app)
	}
}

if (import.meta.filename === process.argv[1]) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error)
		process.exit(1)
	})
}
