export const maxAssetBytes = 50 * 1024 * 1024

export const assetTypes = {
	jpg: { contentType: "image/jpeg", kind: "image" },
	jpeg: { contentType: "image/jpeg", kind: "image" },
	png: { contentType: "image/png", kind: "image" },
	gif: { contentType: "image/gif", kind: "image" },
	webp: { contentType: "image/webp", kind: "image" },
	svg: { contentType: "image/svg+xml", kind: "image" },
	pdf: { contentType: "application/pdf", kind: "pdf" },
	mp3: { contentType: "audio/mpeg", kind: "audio" },
	m4a: { contentType: "audio/mp4", kind: "audio" },
	ogg: { contentType: "audio/ogg", kind: "audio" },
	wav: { contentType: "audio/wav", kind: "audio" },
	mp4: { contentType: "video/mp4", kind: "video" },
	webm: { contentType: "video/webm", kind: "video" },
	bin: { contentType: "application/octet-stream", kind: "file" },
} as const

export const assetExtensionPattern = `(?:${Object.keys(assetTypes).join("|")}|[a-z0-9]{1,10})`

export function assetExtension(name: string): string {
	return new RegExp(`\\.(${assetExtensionPattern})$`, "i").exec(name)?.[1]?.toLowerCase() ?? "bin"
}

export function assetKind(path: string): (typeof assetTypes)[keyof typeof assetTypes]["kind"] {
	if (/\.file\.[a-z0-9]{1,10}$/i.test(path)) return "file"
	const extension = assetExtension(path)
	return Object.hasOwn(assetTypes, extension) ? assetTypes[extension as keyof typeof assetTypes].kind : "file"
}

function readEbmlInteger(bytes: Uint8Array, offset: number) {
	const first = bytes[offset] ?? 0
	const length = Math.clz32(first) - 23
	if (length > 8 || offset + length > bytes.length) return null
	let value = first & (0xff >>> length)
	for (let index = 1; index < length; index++) value = value * 256 + (bytes[offset + index] ?? 0)
	return Number.isSafeInteger(value) ? { value, length } : null
}

export function detectAssetExtension(bytes: Uint8Array): keyof typeof assetTypes | null {
	if ([0xff, 0xd8, 0xff].every((byte, index) => bytes[index] === byte)) return "jpg"
	if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return "png"
	const header = String.fromCharCode(...bytes.subarray(0, 12))
	if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) return "gif"
	if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") return "webp"
	if (header.startsWith("%PDF-")) return "pdf"
	if (header.startsWith("ID3")) return "mp3"
	const second = bytes[1] ?? 0
	const third = bytes[2] ?? 0
	if (
		bytes.length >= 4 &&
		bytes[0] === 0xff &&
		(second & 0xe0) === 0xe0 &&
		(second & 0x18) !== 0x08 &&
		(second & 0x06) !== 0 &&
		(third & 0xf0) !== 0 &&
		(third & 0xf0) !== 0xf0 &&
		(third & 0x0c) !== 0x0c
	)
		return "mp3"
	if (header.startsWith("OggS")) return "ogg"
	if (bytes.length >= 44 && header.startsWith("RIFF") && header.slice(8, 12) === "WAVE") {
		const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true)
		if (size >= 36 && size <= maxAssetBytes - 8 && String.fromCharCode(...bytes.subarray(12, 16)) === "fmt ")
			return "wav"
	}
	if (header.slice(4, 8) === "ftyp") {
		const brand = header.slice(8, 12)
		if (["M4A ", "M4B ", "M4P "].includes(brand)) return "m4a"
		if (["isom", "iso2", "mp41", "mp42", "avc1", "M4V ", "MSNV", "dash"].includes(brand)) return "mp4"
	}
	if ([0x1a, 0x45, 0xdf, 0xa3].every((byte, index) => bytes[index] === byte)) {
		const headerSize = readEbmlInteger(bytes, 4)
		if (!headerSize) return null
		let offset = 4 + headerSize.length
		const end = offset + headerSize.value
		if (end > Math.min(bytes.length, 8192)) return null
		while (offset < end) {
			const id = readEbmlInteger(bytes, offset)
			if (!id) return null
			const size = readEbmlInteger(bytes, offset + id.length)
			if (!size) return null
			const start = offset + id.length + size.length
			const next = start + size.value
			if (next > end) return null
			if (id.length === 2 && bytes[offset] === 0x42 && bytes[offset + 1] === 0x82)
				return String.fromCharCode(...bytes.subarray(start, next)) === "webm" ? "webm" : null
			offset = next
		}
		return null
	}
	const text = new TextDecoder().decode(bytes.subarray(0, 8192))
	if (/^(?:\s|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->)*<svg(?:\s|\/?>)/.test(text)) return "svg"
	return null
}

export function sizeError(name: string, size: number): string {
	return `${name} is ${(size / (1024 * 1024)).toFixed(1)} MB. The limit is ${maxAssetBytes / (1024 * 1024)} MB.`
}

export function assetFileError({ name, size }: { name: string; size: number }): string | null {
	if (size > maxAssetBytes) return sizeError(name, size)
	return null
}
