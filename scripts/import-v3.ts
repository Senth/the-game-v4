import { readFile } from "node:fs/promises"
import { loadEnvConfig } from "@next/env"
import { saveAsset } from "@/lib/assets/files"
import { closeDb } from "@/lib/db/client"
import { createSeason, getSeasonForImport } from "@/lib/db/seasons"
import { assetExtension, detectAssetExtension, maxAssetBytes } from "@/lib/domain/assets"
import { parseV3Export, type V3AssetJob } from "@/lib/domain/v3-import"

type ImportSummary = { imported: number; skipped: number; warnings: string[] }
type DownloadResult = { assetPath?: string; error?: string }

async function downloadAsset(url: string): Promise<string> {
	const response = await fetch(url)
	if (!response.ok) throw new Error(`HTTP ${response.status}`)
	const contentLength = Number(response.headers.get("content-length"))
	if (contentLength > maxAssetBytes) {
		await response.body?.cancel().catch(() => {})
		throw new Error("asset exceeds 50 MB")
	}
	if (!response.body) throw new Error("empty response")

	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let size = 0
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		size += value.byteLength
		if (size > maxAssetBytes) {
			await reader.cancel().catch(() => {})
			throw new Error("asset exceeds 50 MB")
		}
		chunks.push(value)
	}

	const bytes = Buffer.concat(chunks, size)
	const extension = detectAssetExtension(bytes) ?? assetExtension(new URL(url).pathname)
	return saveAsset(bytes, extension)
}

function counts(season: ReturnType<typeof parseV3Export>[number]["season"]) {
	const quests = season.arcs.flatMap((arc) => arc.quests)
	return {
		arcs: season.arcs.length,
		quests: quests.length,
		hints: quests.reduce((count, quest) => count + quest.hints.length, 0),
	}
}

function assetUrls(jobs: Record<string, V3AssetJob[]>): string[] {
	return [...new Set(Object.values(jobs).flatMap((questJobs) => questJobs.map((job) => job.url)))]
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

export async function runV3Import(input: unknown, dryRun = false): Promise<ImportSummary> {
	if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set")
	if (!dryRun && !process.env.ASSETS_DIR) throw new Error("ASSETS_DIR is not set")

	const mappedSeasons = parseV3Export(input)
	const downloads = new Map<string, Promise<DownloadResult>>()
	const preflight = new Map<string, string>()
	const summary: ImportSummary = { imported: 0, skipped: 0, warnings: [] }

	for (const mapped of mappedSeasons) {
		const { season, assetJobs } = mapped
		const existing = await getSeasonForImport(season._id)
		const total = counts(season)
		const urls = existing ? [] : assetUrls(assetJobs)
		console.log(
			`Season ${JSON.stringify(season.title)} (${season._id}): ${total.arcs} arcs, ${total.quests} quests, ${total.hints} hints, ${urls.length} assets to download${existing ? "; exists, skipped" : ""}`,
		)
		summary.warnings.push(...mapped.warnings)

		if (existing) {
			summary.skipped += 1
			continue
		}
		if (dryRun) {
			for (const arc of season.arcs) {
				for (const quest of arc.quests) {
					const context = `Season ${JSON.stringify(season.title)} (${season._id}), arc ${JSON.stringify(arc.title)}, quest ${JSON.stringify(quest.internalTitle || quest.displayTitle || quest.id)}`
					for (const job of assetJobs[quest.id] ?? []) {
						if (!preflight.has(job.url)) preflight.set(job.url, context)
					}
				}
			}
			continue
		}

		for (const arc of season.arcs) {
			for (const quest of arc.quests) {
				for (const job of assetJobs[quest.id] ?? []) {
					let download = downloads.get(job.url)
					if (!download) {
						download = downloadAsset(job.url)
							.then((assetPath) => ({ assetPath }))
							.catch((error: unknown) => ({ error: errorMessage(error) }))
						downloads.set(job.url, download)
					}
					const result = await download
					if (result.error) {
						quest.adminNotes = [quest.adminNotes, `v3 asset not imported: ${job.url}`].filter(Boolean).join("\n")
						summary.warnings.push(
							`Season ${JSON.stringify(season.title)} (${season._id}), arc ${JSON.stringify(arc.title)}, quest ${JSON.stringify(quest.internalTitle || quest.displayTitle || quest.id)}: v3 asset not imported: ${job.url} (${result.error})`,
						)
						continue
					}
					if (!result.assetPath) throw new Error(`No local path for v3 asset ${job.url}`)
					if (job.target === "assetPath") quest.assetPath = result.assetPath
					else quest.content = `${quest.content}${quest.content ? "\n\n" : ""}![](${result.assetPath})`
				}
			}
		}

		await createSeason(season)
		summary.imported += 1
	}

	if (dryRun) {
		const assets = [...preflight]
		for (let index = 0; index < assets.length; index += 8) {
			const batch = assets.slice(index, index + 8)
			const warnings = await Promise.all(
				batch.map(async ([url, context]) => {
					try {
						const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) })
						const issues: string[] = []
						if (!response.ok) issues.push(`HTTP ${response.status}`)
						if (Number(response.headers.get("content-length")) > maxAssetBytes) {
							issues.push("asset exceeds 50 MB")
						}
						return issues.map((issue) => `${context}: asset preflight failed for ${url} (${issue})`)
					} catch (error) {
						return [`${context}: asset preflight failed for ${url} (${errorMessage(error)})`]
					}
				}),
			)
			summary.warnings.push(...warnings.flat())
		}
	}

	for (const warning of summary.warnings) console.warn(warning)
	console.log(
		`Import summary: ${summary.imported} imported, ${summary.skipped} skipped, ${summary.warnings.length} warnings`,
	)
	return summary
}

async function main() {
	loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production")
	const args = process.argv.slice(2)
	const dryRun = args.includes("--dry-run")
	const files = args.filter((arg) => arg !== "--dry-run")
	if (files.length !== 1 || !files[0]) throw new Error("Usage: pnpm import:v3 <export.json> [--dry-run]")
	if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set")
	if (!dryRun && !process.env.ASSETS_DIR) throw new Error("ASSETS_DIR is not set")

	try {
		const input = JSON.parse(await readFile(files[0], "utf8"))
		const result = await runV3Import(input, dryRun)
		if (result.warnings.length) process.exitCode = 1
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
