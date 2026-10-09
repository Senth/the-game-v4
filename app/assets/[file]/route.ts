import { readFile } from "node:fs/promises"
import { resolveAssetFile } from "@/lib/assets/files"

export const runtime = "nodejs"

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
	const asset = resolveAssetFile((await params).file)
	if (!asset) return new Response(null, { status: 404 })

	try {
		const content = await readFile(asset.path)
		return new Response(content, {
			headers: {
				"Content-Type": asset.contentType,
				"Cache-Control": "public, max-age=31536000, immutable",
			},
		})
	} catch {
		return new Response(null, { status: 404 })
	}
}
