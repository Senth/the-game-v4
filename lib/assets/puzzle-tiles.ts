import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import { Puzzle } from "@/lib/domain/schemas"
import { assetsDir, resolveAssetFile } from "./files"

type PuzzleTiles = { directory: string; aspect: number }

const cache = globalThis as typeof globalThis & { theGamePuzzleCuts?: Map<string, Promise<PuzzleTiles>> }
cache.theGamePuzzleCuts ??= new Map()
const cuts = cache.theGamePuzzleCuts

function cacheDirectory(assetPath: string, rows: number, cols: number): string {
	const key = createHash("sha256").update(`v2:${assetPath}:${rows}x${cols}`).digest("hex")
	return path.join(assetsDir(), ".puzzles", key)
}

export function getPuzzleTiles(assetPath: string, rows: number, cols: number): Promise<PuzzleTiles> {
	Puzzle.parse({ rows, cols })
	const asset = resolveAssetFile(assetPath.slice("/assets/".length))
	if (!assetPath.startsWith("/assets/") || !asset) return Promise.reject(new Error("Invalid puzzle asset"))
	const directory = cacheDirectory(assetPath, rows, cols)
	const pending = cuts.get(directory)
	if (pending) return pending
	const cut = cutTiles(asset.path, directory, rows, cols).finally(() => cuts.delete(directory))
	cuts.set(directory, cut)
	return cut
}

async function cutTiles(source: string, directory: string, rows: number, cols: number): Promise<PuzzleTiles> {
	try {
		const aspect = JSON.parse(await readFile(path.join(directory, "aspect.json"), "utf8")) as number
		return { directory, aspect }
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
	}
	const { data, info } = await sharp(await readFile(source), { animated: false })
		.autoOrient()
		.flatten()
		.resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
		.raw()
		.toBuffer({ resolveWithObject: true })
	const { width, height, channels } = info
	const tileWidth = Math.max(1, Math.floor(width / cols))
	const tileHeight = Math.max(1, Math.floor(height / rows))
	const normalizedWidth = tileWidth * cols
	const normalizedHeight = tileHeight * rows
	const normalized = await sharp(data, { raw: { width, height, channels } })
		.resize(normalizedWidth, normalizedHeight, { fit: "fill" })
		.raw()
		.toBuffer()
	await mkdir(path.dirname(directory), { recursive: true })
	const temporary = await mkdtemp(`${directory}-`)
	try {
		const image = sharp(normalized, { raw: { width: normalizedWidth, height: normalizedHeight, channels } })
		await image.clone().webp().toFile(path.join(temporary, "full.webp"))
		for (let index = 0; index < rows * cols; index++) {
			const col = index % cols
			const row = Math.floor(index / cols)
			await image
				.clone()
				.extract({
					left: col * tileWidth,
					top: row * tileHeight,
					width: tileWidth,
					height: tileHeight,
				})
				.webp()
				.toFile(path.join(temporary, `${index}.webp`))
		}
		const aspect = normalizedWidth / normalizedHeight
		await writeFile(path.join(temporary, "aspect.json"), JSON.stringify(aspect))
		await rename(temporary, directory)
		return { directory, aspect }
	} finally {
		await rm(temporary, { recursive: true, force: true })
	}
}

export async function deletePuzzleTiles(assetPath: string): Promise<void> {
	for (let rows = 2; rows <= 7; rows++) {
		for (let cols = 2; cols <= 7; cols++) {
			const directory = cacheDirectory(assetPath, rows, cols)
			await cuts.get(directory)?.catch(() => {})
			await rm(directory, { recursive: true, force: true })
		}
	}
}
