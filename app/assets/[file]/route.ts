import { type FileHandle, open } from "node:fs/promises"
import { Readable } from "node:stream"
import { resolveAssetFile } from "@/lib/assets/files"
import { assetTypes, detectAssetExtension } from "@/lib/domain/assets"

export const runtime = "nodejs"

export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
	const filename = (await params).file
	const asset = resolveAssetFile(filename)
	if (!asset) return new Response(null, { status: 404 })

	let file: FileHandle | undefined
	try {
		file = await open(asset.path, "r")
		const stats = await file.stat()
		if (!stats.isFile()) {
			await file.close()
			return new Response(null, { status: 404 })
		}
		const { size } = stats
		const prefix = Buffer.alloc(Math.min(size, 8192))
		await file.read(prefix, 0, prefix.length, 0)
		const extension = detectAssetExtension(prefix) ?? "bin"
		const type = assetTypes[extension]
		const headers = new Headers({
			"Content-Type": type.contentType,
			"Cache-Control": "public, max-age=31536000, immutable",
			"X-Content-Type-Options": "nosniff",
			"Accept-Ranges": "bytes",
		})
		if (type.kind === "file") headers.set("Content-Disposition", `attachment; filename="${filename}"`)
		if (extension === "svg") headers.set("Content-Security-Policy", "sandbox")

		let start = 0
		let end = size - 1
		let status = 200
		const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "")
		if (range && (range[1] || range[2])) {
			start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
			end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
			if (!Number.isSafeInteger(start) || start >= size || end < start || (!range[1] && Number(range[2]) === 0)) {
				await file.close()
				headers.set("Content-Range", `bytes */${size}`)
				return new Response(null, { status: 416, headers })
			}
			status = 206
			headers.set("Content-Range", `bytes ${start}-${end}/${size}`)
		}
		headers.set("Content-Length", String(size === 0 ? 0 : end - start + 1))
		if (size === 0) {
			await file.close()
			return new Response(null, { status, headers })
		}
		const stream = Readable.toWeb(file.createReadStream({ start, end })) as ReadableStream<Uint8Array>
		return new Response(stream, { status, headers })
	} catch {
		await file?.close().catch(() => {})
		return new Response(null, { status: 404 })
	}
}
