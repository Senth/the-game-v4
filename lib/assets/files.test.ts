import * as fs from "node:fs/promises"
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { GET } from "../../app/assets/[file]/route"
import { deleteAssetFile, assetsDir as getAssetsDir, resolveAssetFile, saveAsset } from "./files"

vi.mock("node:fs/promises", async (original) => {
	const fs = await original<typeof import("node:fs/promises")>()
	return { ...fs, writeFile: vi.fn(fs.writeFile) }
})

const filename = "01234567-89ab-cdef-0123-456789abcdef.png"
const content = Buffer.from("asset contents")
let assetsDir: string
let previousAssetsDir: string | undefined

beforeAll(async () => {
	previousAssetsDir = process.env.ASSETS_DIR
	assetsDir = await mkdtemp(path.resolve(".tmp", "asset-route-"))
	process.env.ASSETS_DIR = assetsDir
	await writeFile(path.join(assetsDir, filename), content)
})

describe("asset file storage", () => {
	it("resolves the configured directory", () => {
		expect(getAssetsDir()).toBe(path.resolve(assetsDir))
	})

	it("creates the directory and saves bytes under a UUID filename", async () => {
		process.env.ASSETS_DIR = path.join(assetsDir, "new")
		try {
			const assetPath = await saveAsset(content, "jpg")
			expect(assetPath).toMatch(/^\/assets\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.jpg$/)
			const asset = resolveAssetFile(path.basename(assetPath))
			expect(asset?.contentType).toBe("image/jpeg")
			if (!asset) throw new Error("Saved asset filename did not resolve")
			expect(await readFile(asset.path)).toEqual(content)
		} finally {
			process.env.ASSETS_DIR = assetsDir
		}
	})

	it("deletes a saved file and ignores a missing file", async () => {
		const assetPath = await saveAsset(content, "png")
		const file = resolveAssetFile(path.basename(assetPath))
		if (!file) throw new Error("Saved asset filename did not resolve")
		await deleteAssetFile(assetPath)
		await expect(access(file.path)).rejects.toMatchObject({ code: "ENOENT" })
		await expect(deleteAssetFile(assetPath)).resolves.toBeUndefined()
	})

	it("removes a partial file when writing fails", async () => {
		const error = new Error("Disk full")
		let partialPath = ""
		const { writeFile: realWrite } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
		const write = vi.spyOn(fs, "writeFile").mockImplementationOnce(async (file) => {
			partialPath = String(file)
			await realWrite(file, "partial")
			throw error
		})
		try {
			await expect(saveAsset(content, "png")).rejects.toBe(error)
			await expect(access(partialPath)).rejects.toMatchObject({ code: "ENOENT" })
		} finally {
			write.mockRestore()
		}
	})

	it.each(["../x.png", "/assets/legacy.png"])("ignores non-matching path %s", async (assetPath) => {
		const file = path.join(assetsDir, path.basename(assetPath))
		await writeFile(file, content)
		await expect(deleteAssetFile(assetPath)).resolves.toBeUndefined()
		expect(await readFile(file)).toEqual(content)
	})

	it("does not swallow other filesystem errors", async () => {
		await expect(deleteAssetFile("/assets/01234567-89ab-cdef-0123-456789abcdef.webp")).resolves.toBeUndefined()
		process.env.ASSETS_DIR = path.join(assetsDir, filename)
		try {
			await expect(deleteAssetFile(`/assets/${filename}`)).rejects.toMatchObject({ code: "ENOTDIR" })
		} finally {
			process.env.ASSETS_DIR = assetsDir
		}
	})
})

afterAll(async () => {
	await rm(assetsDir, { recursive: true, force: true })
	if (previousAssetsDir === undefined) delete process.env.ASSETS_DIR
	else process.env.ASSETS_DIR = previousAssetsDir
})

async function getAsset(file: string) {
	return GET(new Request(`http://localhost/assets/${encodeURIComponent(file)}`), {
		params: Promise.resolve({ file }),
	})
}

describe("GET /assets/[file]", () => {
	it("serves allowed assets with content type and immutable caching", async () => {
		const response = await getAsset(filename)

		expect(response.status).toBe(200)
		expect(response.headers.get("Content-Type")).toBe("image/png")
		expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable")
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
		expect(Buffer.from(await response.arrayBuffer())).toEqual(content)
	})

	it.each(["..%2Fsecret.png", "../secret.png"])("returns 404 for traversal name %s", async (file) => {
		expect((await getAsset(file)).status).toBe(404)
	})

	it("returns 404 for a bad extension", async () => {
		expect((await getAsset("01234567-89ab-cdef-0123-456789abcdef.svg")).status).toBe(404)
	})

	it("returns 404 when an allowed asset is missing", async () => {
		expect((await getAsset("11234567-89ab-cdef-0123-456789abcdef.pdf")).status).toBe(404)
	})
})
