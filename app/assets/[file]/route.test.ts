import { mkdir, mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { saveAsset } from "@/lib/assets/files"
import { GET } from "./route"

let directory: string

beforeAll(async () => {
	await mkdir(path.resolve(".tmp"), { recursive: true })
	directory = await mkdtemp(path.resolve(".tmp", "asset-route-security-"))
	vi.stubEnv("ASSETS_DIR", directory)
})

afterAll(async () => {
	vi.unstubAllEnvs()
	await rm(directory, { recursive: true, force: true })
})

describe.each([
	{ extension: "svg", contentType: "image/svg+xml", bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') },
	{ extension: "png", contentType: "image/png", bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 42]) },
	{ extension: "svg", contentType: "application/octet-stream", bytes: Buffer.from("<html>not an SVG</html>") },
])("GET /assets/[file] with $contentType bytes", ({ extension, contentType, bytes }) => {
	it.each([
		{ range: undefined, status: 200 },
		{ range: "bytes=1-3", status: 206 },
		{ range: "bytes=9999-", status: 416 },
	])("serves safe headers and correct bytes for $status", async ({ range, status }) => {
		const file = path.basename(await saveAsset(bytes, extension))
		const response = await GET(
			new Request(`http://localhost/assets/${file}`, { headers: range ? { Range: range } : {} }),
			{ params: Promise.resolve({ file }) },
		)
		expect(response.status).toBe(status)
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
		expect(response.headers.get("Content-Type")).toBe(contentType)
		if (contentType === "image/svg+xml") expect(response.headers.get("Content-Security-Policy")).toBe("sandbox")
		if (contentType === "application/octet-stream")
			expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="${file}"`)
		if (status === 206) expect(response.headers.get("Content-Range")).toBe(`bytes 1-3/${bytes.length}`)
		if (status === 416) expect(response.headers.get("Content-Range")).toBe(`bytes */${bytes.length}`)
		expect(Buffer.from(await response.arrayBuffer())).toEqual(
			status === 416 ? Buffer.alloc(0) : status === 206 ? bytes.subarray(1, 4) : bytes,
		)
	})
})
