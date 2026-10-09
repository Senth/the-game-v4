import path from "node:path"

const contentTypes = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	gif: "image/gif",
	webp: "image/webp",
	pdf: "application/pdf",
} as const

const assetName = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp|pdf)$/i

export function resolveAssetFile(file: string) {
	const match = assetName.exec(file)
	if (!match) return null

	const extension = match[1]!.toLowerCase() as keyof typeof contentTypes
	return {
		path: path.resolve(process.env.ASSETS_DIR ?? ".tmp/assets", file),
		contentType: contentTypes[extension],
	}
}
