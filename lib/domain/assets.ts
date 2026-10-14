export const maxAssetBytes = 10 * 1024 * 1024

export const contentTypes = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	gif: "image/gif",
	webp: "image/webp",
	pdf: "application/pdf",
} as const

export function detectAssetExtension(bytes: Uint8Array): "jpg" | "png" | "gif" | "webp" | "pdf" | null {
	if ([0xff, 0xd8, 0xff].every((byte, index) => bytes[index] === byte)) return "jpg"
	if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return "png"
	const header = String.fromCharCode(...bytes.subarray(0, 12))
	if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) return "gif"
	if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") return "webp"
	if (header.startsWith("%PDF-")) return "pdf"
	return null
}

export function typeError(name: string): string {
	return `${name} is not jpg, png, gif, webp or pdf.`
}

export function sizeError(name: string, size: number): string {
	return `${name} is ${(size / (1024 * 1024)).toFixed(1)} MB. The limit is 10 MB.`
}

export function assetFileError({ name, size }: { name: string; size: number }): string | null {
	const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase()
	if (!name.includes(".") || !Object.hasOwn(contentTypes, extension)) return typeError(name)
	if (size > maxAssetBytes) return sizeError(name, size)
	return null
}
