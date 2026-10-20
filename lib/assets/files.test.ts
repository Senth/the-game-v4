import * as fs from "node:fs/promises"
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { GET } from "../../app/assets/[file]/route"
import { deleteAssetFile, assetsDir as getAssetsDir, resolveAssetFile, saveAsset } from "./files"

vi.mock("node:fs/promises", async (original) => {
	const fs = await original<typeof import("node:fs/promises")>()
	return { ...fs, writeFile: vi.fn(fs.writeFile) }
})

const filename = "01234567-89ab-cdef-0123-456789abcdef.png"
const content = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(248, 42)])
let assetsDir: string
let previousAssetsDir: string | undefined

beforeAll(async () => {
	previousAssetsDir = process.env.ASSETS_DIR
	await mkdir(path.resolve(".tmp"), { recursive: true })
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

async function getAsset(file: string, range?: string) {
	return GET(
		new Request(`http://localhost/assets/${encodeURIComponent(file)}`, { headers: range ? { Range: range } : {} }),
		{
			params: Promise.resolve({ file }),
		},
	)
}

describe("GET /assets/[file]", () => {
	it("serves allowed assets with content type and immutable caching", async () => {
		const response = await getAsset(filename)

		expect(response.status).toBe(200)
		expect(response.headers.get("Content-Type")).toBe("image/png")
		expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable")
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
		expect(response.headers.get("Accept-Ranges")).toBe("bytes")
		expect(response.headers.get("Content-Length")).toBe(String(content.length))
		expect(Buffer.from(await response.arrayBuffer())).toEqual(content)
	})

	it.each(["..%2Fsecret.png", "../secret.png"])("returns 404 for traversal name %s", async (file) => {
		expect((await getAsset(file)).status).toBe(404)
	})

	it.each(["toolongextension", "bad-ext", "html/secret", "png\r\nX-Evil: yes"])(
		"returns 404 for bad extension %s",
		async (extension) => {
			expect((await getAsset(`01234567-89ab-cdef-0123-456789abcdef.${extension}`)).status).toBe(404)
		},
	)

	it.each([
		["bytes=0-99", 0, 99],
		["bytes=100-", 100, 255],
		["bytes=-20", 236, 255],
		["bytes=240-999", 240, 255],
		["bytes=-999", 0, 255],
	])("streams single range %s", async (range, start, end) => {
		const response = await getAsset(filename, range)
		expect(response.status).toBe(206)
		expect(response.headers.get("Content-Range")).toBe(`bytes ${start}-${end}/${content.length}`)
		expect(response.headers.get("Accept-Ranges")).toBe("bytes")
		expect(response.headers.get("Content-Length")).toBe(String(end - start + 1))
		expect(Buffer.from(await response.arrayBuffer())).toEqual(content.subarray(start, end + 1))
	})

	it.each(["bytes=256-", "bytes=100-99", "bytes=-0"])("rejects unsatisfiable range %s", async (range) => {
		const response = await getAsset(filename, range)
		expect(response.status).toBe(416)
		expect(response.headers.get("Content-Range")).toBe(`bytes */${content.length}`)
		expect(await response.text()).toBe("")
	})

	it.each(["bytes=0-9,20-29", "bytes=wat", "items=0-1"])("ignores unsupported or malformed range %s", async (range) => {
		const response = await getAsset(filename, range)
		expect(response.status).toBe(200)
		expect(Buffer.from(await response.arrayBuffer())).toEqual(content)
	})

	it.each(["html", "svg", "wav", "png", "mp4"])(
		"serves unrecognized .%s bytes only as attachment",
		async (extension) => {
			const assetPath = await saveAsset(Buffer.from("<html><script>alert(1)</script></html>"), extension)
			const response = await getAsset(path.basename(assetPath))
			expect(response.status).toBe(200)
			expect(response.headers.get("Content-Type")).toBe("application/octet-stream")
			expect(response.headers.get("Content-Disposition")).toContain("attachment")
			expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
			await response.body?.cancel()
		},
	)

	it("sandboxes SVG even on partial responses", async () => {
		const assetPath = await saveAsset(Buffer.from('\ufeff<?xml version="1.0"?><!-- drawing --><svg/>'), "svg")
		const response = await getAsset(path.basename(assetPath), "bytes=0-9")
		expect(response.status).toBe(206)
		expect(response.headers.get("Content-Type")).toBe("image/svg+xml")
		expect(response.headers.get("Content-Security-Policy")).toBe("sandbox")
		expect(response.headers.get("Content-Disposition")).toBeNull()
		await response.body?.cancel()
	})

	it("serves empty files and rejects their ranges", async () => {
		const assetPath = await saveAsset(new Uint8Array(), "bin")
		const file = path.basename(assetPath)
		expect(await (await getAsset(file)).text()).toBe("")
		expect((await getAsset(file, "bytes=0-")).status).toBe(416)
	})

	it("returns 404 when an allowed asset is missing", async () => {
		expect((await getAsset("11234567-89ab-cdef-0123-456789abcdef.pdf")).status).toBe(404)
	})
})
