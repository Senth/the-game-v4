import { describe, expect, it } from "vitest"
import { assetFileError, detectAssetExtension, maxAssetBytes, sizeError, typeError } from "./assets"

const signatures = [
	["jpg", [0xff, 0xd8, 0xff]],
	["png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
	["gif", Array.from(Buffer.from("GIF87a"))],
	["gif", Array.from(Buffer.from("GIF89a"))],
	["webp", Array.from(Buffer.from("RIFF\x00\x01\x02\x03WEBP"))],
	["pdf", Array.from(Buffer.from("%PDF-"))],
] as const

describe("detectAssetExtension", () => {
	it.each(signatures)("detects %s from bytes", (extension, bytes) => {
		expect(detectAssetExtension(new Uint8Array(bytes))).toBe(extension)
	})

	it.each(signatures)("rejects every truncated %s signature", (_extension, bytes) => {
		for (let length = 0; length < bytes.length; length++) {
			expect(detectAssetExtension(new Uint8Array(bytes.slice(0, length)))).toBeNull()
		}
	})

	it.each(["<svg></svg>", "<!DOCTYPE html><html></html>", "\x00\x00\x00\x18ftypheic", "RIFF1234WAVE"])(
		"rejects unsupported bytes %s",
		(bytes) => {
			expect(detectAssetExtension(new Uint8Array(Buffer.from(bytes)))).toBeNull()
		},
	)

	it("detects a PNG named jpg as png", () => {
		const file = { name: "image.jpg", bytes: new Uint8Array(signatures[1][1]), size: 8 }
		expect(assetFileError(file)).toBeNull()
		expect(detectAssetExtension(file.bytes)).toBe("png")
	})
})

describe("assetFileError", () => {
	it.each(["jpg", "jpeg", "png", "gif", "webp", "pdf"])("accepts upper-case %s and exactly 10 MB", (extension) => {
		expect(assetFileError({ name: `image.${extension.toUpperCase()}`, size: maxAssetBytes })).toBeNull()
	})

	it.each(["image.svg", "image.html", "image.heic", "image", "image.png.exe"])(
		"rejects unsupported filename %s",
		(name) => {
			expect(assetFileError({ name, size: 1 })).toBe(`${name} is not jpg, png, gif, webp or pdf.`)
		},
	)

	it("rejects 10 MB plus one byte with exact copy", () => {
		expect(assetFileError({ name: "image.png", size: maxAssetBytes + 1 })).toBe(
			"image.png is 10.0 MB. The limit is 10 MB.",
		)
	})

	it("builds shared type and one-decimal binary-MB size errors", () => {
		expect(typeError("image.heic")).toBe("image.heic is not jpg, png, gif, webp or pdf.")
		expect(sizeError("image.png", 12.25 * 1024 * 1024)).toBe("image.png is 12.3 MB. The limit is 10 MB.")
	})
})
