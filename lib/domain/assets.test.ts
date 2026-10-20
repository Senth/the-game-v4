import { describe, expect, it } from "vitest"
import { assetExtension, assetFileError, assetKind, detectAssetExtension, maxAssetBytes, sizeError } from "./assets"

const wave = Buffer.alloc(44)
wave.write("RIFF")
wave.writeUInt32LE(36, 4)
wave.write("WAVEfmt ", 8)

const signatures = [
	["jpg", Buffer.from([0xff, 0xd8, 0xff])],
	["png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
	["gif", Buffer.from("GIF87a")],
	["gif", Buffer.from("GIF89a")],
	["webp", Buffer.from("RIFF\x00\x01\x02\x03WEBP")],
	["pdf", Buffer.from("%PDF-")],
	["mp3", Buffer.from("ID3")],
	["mp3", Buffer.from([0xff, 0xfb, 0x90, 0x00])],
	["m4a", Buffer.from("\x00\x00\x00\x18ftypM4A ")],
	["ogg", Buffer.from("OggS")],
	["wav", wave],
	["mp4", Buffer.from("\x00\x00\x00\x18ftypisom")],
	["webm", Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, ...Buffer.from("webm")])],
] as const

describe("detectAssetExtension", () => {
	it.each(signatures)("detects %s from bytes", (extension, bytes) => {
		expect(detectAssetExtension(bytes)).toBe(extension)
	})

	it.each(signatures)("rejects every truncated %s signature", (_extension, bytes) => {
		for (let length = 0; length < bytes.length; length++) {
			expect(detectAssetExtension(bytes.subarray(0, length))).toBeNull()
		}
	})

	it.each([
		"<svg></svg>",
		"<svg/>",
		'\ufeff \n<?xml version="1.0"?>\n<!-- drawing -->\n<svg xmlns="http://www.w3.org/2000/svg"/ >',
		"<!-- first --><!-- second -->\n<svg viewBox='0 0 1 1'>",
	])("detects SVG with allowed preamble %s", (text) => {
		expect(detectAssetExtension(Buffer.from(text))).toBe("svg")
	})

	it.each(
		[
			[0x1a, 0x45, 0xdf, 0xa3, 0x8b, 0x42, 0x82, 0x88, ...Buffer.from("matroska")],
			[0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x42, 0x82, 0x84, ...Buffer.from("webm")],
			[0x1a, 0x45, 0xdf, 0xa3, 0x8a, 0x42, 0x86, 0x87, 0x42, 0x82, 0x84, ...Buffer.from("webm")],
			[0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x85, ...Buffer.from("webm")],
			[0x1a, 0x45, 0xdf, 0xa3, 0x00],
		].map((bytes) => ({ bytes })),
	)("rejects non-WebM or malformed EBML header $bytes", ({ bytes }) => {
		expect(detectAssetExtension(Uint8Array.from(bytes))).toBeNull()
	})

	it("reads WebM DocType after other EBML fields and a multibyte size", () => {
		const bytes = [0x1a, 0x45, 0xdf, 0xa3, 0x40, 0x0b, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84, ...Buffer.from("webm")]
		expect(detectAssetExtension(Uint8Array.from(bytes))).toBe("webm")
	})

	it.each([
		"<!DOCTYPE html><html></html>",
		"\x00\x00\x00\x18ftypheic",
		"RIFF1234WAVE",
		"<svgscript></svgscript>",
		"<html><svg></svg></html>",
		"<!-- unfinished <svg>",
		"",
	])("leaves unrecognized bytes %s as generic files", (bytes) => {
		expect(detectAssetExtension(Buffer.from(bytes))).toBeNull()
	})
})

describe("assetExtension and assetKind", () => {
	it.each([
		["notes.HTML", "html", "file"],
		["track.M4A", "m4a", "audio"],
		["movie.mp4", "mp4", "video"],
		["/assets/picture.jpeg", "jpeg", "image"],
		["map.svg", "svg", "image"],
		["file.pdf", "pdf", "pdf"],
		["no-extension", "bin", "file"],
		["trailing.", "bin", "file"],
		["file.1234567890", "1234567890", "file"],
		["file.12345678901", "bin", "file"],
		["file.bad-ext", "bin", "file"],
		["file.💾", "bin", "file"],
	])("classifies %s", (name, extension, kind) => {
		expect(assetExtension(name)).toBe(extension)
		expect(assetKind(name)).toBe(kind)
	})
})

describe("assetFileError", () => {
	it.each(["image.svg", "image.html", "image.heic", "image", "image.png.exe"])(
		"accepts any filename %s at exactly 50 MiB",
		(name) => {
			expect(maxAssetBytes).toBe(50 * 1024 * 1024)
			expect(assetFileError({ name, size: maxAssetBytes })).toBeNull()
		},
	)

	it("rejects 50 MiB plus one byte with exact copy", () => {
		expect(assetFileError({ name: "image.png", size: maxAssetBytes + 1 })).toBe(
			"image.png is 50.0 MB. The limit is 50 MB.",
		)
		expect(sizeError("image.png", 52.25 * 1024 * 1024)).toBe("image.png is 52.3 MB. The limit is 50 MB.")
	})
})
