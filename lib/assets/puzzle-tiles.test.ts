import { createHash } from "node:crypto"
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { GET as getPublicAsset } from "@/app/assets/[file]/route"
import { isAssetReferenced } from "@/lib/db/seasons"
import { saveAsset } from "./files"
import { getPuzzleTiles } from "./puzzle-tiles"
import { releaseAsset } from "./release"

vi.mock("@/lib/db/seasons", () => ({ isAssetReferenced: vi.fn() }))

let directory: string
const previousAssetsDir = process.env.ASSETS_DIR

beforeAll(async () => {
	await mkdir(".tmp", { recursive: true })
	directory = await mkdtemp(path.resolve(".tmp/puzzle-tiles-"))
	process.env.ASSETS_DIR = directory
})

afterAll(async () => {
	await rm(directory, { recursive: true, force: true })
	if (previousAssetsDir === undefined) delete process.env.ASSETS_DIR
	else process.env.ASSETS_DIR = previousAssetsDir
})

describe("private puzzle tiles", () => {
	it("serializes cuts, downsizes, strips metadata and partitions the entire image", async () => {
		const image = await sharp({ create: { width: 3202, height: 1802, channels: 4, background: "red" } })
			.withMetadata({ exif: { IFD0: { Artist: "Hidden author" } } })
			.png()
			.toBuffer()
		const assetPath = await saveAsset(image, "png")
		const results = await Promise.all(Array.from({ length: 8 }, () => getPuzzleTiles(assetPath, 3, 7)))
		const tiles = results[0]
		if (!tiles) throw new Error("No tiles generated")
		expect(results.every((result) => result.directory === tiles.directory)).toBe(true)
		const key = createHash("sha256").update(`v2:${assetPath}:3x7`).digest("hex")
		expect(tiles.directory).toBe(path.join(directory, ".puzzles", key))
		const full = await sharp(await readFile(path.join(tiles.directory, "full.webp"))).metadata()
		expect(full).toMatchObject({ width: 1596, height: 900, format: "webp", hasAlpha: false })
		expect(full.exif).toBeUndefined()
		expect(tiles.aspect).toBe(1596 / 900)
		expect((await readdir(tiles.directory)).filter((file) => file.endsWith(".webp"))).toHaveLength(22)
		for (let index = 0; index < 21; index++) {
			const tile = await sharp(await readFile(path.join(tiles.directory, `${index}.webp`))).metadata()
			expect(tile).toMatchObject({
				width: 228,
				height: 300,
				format: "webp",
				hasAlpha: false,
			})
			expect(tile.exif).toBeUndefined()
		}
		await writeFile(path.join(directory, path.basename(assetPath)), "removed source bytes")
		expect(await getPuzzleTiles(assetPath, 3, 7)).toEqual(tiles)
		expect(await readdir(path.join(directory, ".puzzles"))).toEqual([key])
	})

	it("rasterizes SVG without enlarging it", async () => {
		const assetPath = await saveAsset(
			Buffer.from(
				'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="blue"/></svg>',
			),
			"svg",
		)
		const tiles = await getPuzzleTiles(assetPath, 2, 2)
		expect(await sharp(await readFile(path.join(tiles.directory, "full.webp"))).metadata()).toMatchObject({
			width: 100,
			height: 60,
			hasAlpha: false,
		})
	})

	it("uses only the first GIF frame", async () => {
		const pixels = Buffer.concat([Buffer.alloc(20 * 20 * 3, 0), Buffer.alloc(20 * 20 * 3, 255)])
		const gif = await sharp(pixels, { raw: { width: 20, height: 40, channels: 3, pageHeight: 20 } })
			.gif()
			.toBuffer()
		expect((await sharp(gif, { animated: true }).metadata()).pages).toBe(2)
		const tiles = await getPuzzleTiles(await saveAsset(gif, "gif"), 2, 2)
		const full = await sharp(await readFile(path.join(tiles.directory, "full.webp")))
			.raw()
			.toBuffer({ resolveWithObject: true })
		expect(full.info).toMatchObject({ width: 20, height: 20 })
		expect(Math.max(...full.data)).toBe(0)
	})

	it("retries a failed cut without retaining a failed promise", async () => {
		const assetPath = await saveAsset(Buffer.from("invalid image"), "png")
		await expect(getPuzzleTiles(assetPath, 2, 2)).rejects.toThrow()
		await writeFile(
			path.join(directory, path.basename(assetPath)),
			await sharp({ create: { width: 20, height: 20, channels: 3, background: "red" } })
				.png()
				.toBuffer(),
		)
		expect((await getPuzzleTiles(assetPath, 2, 2)).aspect).toBe(1)
	})

	it("removes every grid cache only when the asset is no longer referenced", async () => {
		const assetPath = await saveAsset(
			await sharp({ create: { width: 70, height: 70, channels: 3, background: "red" } })
				.png()
				.toBuffer(),
			"png",
		)
		const first = await getPuzzleTiles(assetPath, 2, 2)
		const second = await getPuzzleTiles(assetPath, 7, 7)
		vi.mocked(isAssetReferenced).mockResolvedValueOnce(true)
		await releaseAsset(assetPath)
		await expect(access(first.directory)).resolves.toBeUndefined()
		vi.mocked(isAssetReferenced).mockResolvedValue(false)
		await releaseAsset(assetPath)
		for (const file of [first.directory, second.directory, path.join(directory, path.basename(assetPath))]) {
			await expect(access(file)).rejects.toMatchObject({ code: "ENOENT" })
		}
	})

	it.each([".puzzles/key/full.webp", "../.puzzles/key/0.webp", "%2e%2e%2f.puzzles/key/full.webp"])(
		"blocks public cache access through %s",
		async (file) => {
			expect(
				(await getPublicAsset(new Request("http://localhost/assets/test"), { params: Promise.resolve({ file }) }))
					.status,
			).toBe(404)
		},
	)

	it.each(["/assets/../secret.png", "/assets/.puzzles/key/full.webp", "../image.png"])(
		"rejects source traversal %s",
		async (assetPath) => {
			await expect(getPuzzleTiles(assetPath, 2, 2)).rejects.toThrow()
		},
	)
})
