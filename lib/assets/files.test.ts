import { mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { GET } from "../../app/assets/[file]/route"

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
