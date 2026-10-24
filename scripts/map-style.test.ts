import { readFileSync } from "node:fs"
import type { StyleSpecification } from "maplibre-gl"
import { describe, expect, it } from "vitest"
import style from "@/public/map/navy.json"
import { navyStyle } from "./map-style"

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")

describe("navy map style", () => {
	it("keeps every remote URL on OpenFreeMap, including source tiles, glyphs and sprites", () => {
		const urls = JSON.stringify(style).match(/https?:\/\/[^"\s]+/g) ?? []
		expect(urls.length).toBeGreaterThanOrEqual(4)
		for (const url of urls) expect(new URL(url).hostname).toBe("tiles.openfreemap.org")
		expect(style.sources.openmaptiles.url).toBe("https://tiles.openfreemap.org/planet")
	})

	it("uses runtime tokens, preserves source assets, and declares attribution exactly once", () => {
		const original = structuredClone(style) as StyleSpecification
		const before = structuredClone(original)
		const regenerated = navyStyle(original, css)
		expect(original).toEqual(before)
		expect(regenerated).toEqual(style)
		expect(JSON.stringify(style).match(/OpenFreeMap © OpenMapTiles Data from OpenStreetMap/g)).toHaveLength(1)
		const tokens = [...css.matchAll(/--color-[\w-]+:\s*(#[\da-f]+);/gi)].map(([, color]) => color)
		for (const layer of regenerated.layers) {
			for (const [key, value] of Object.entries(layer.paint ?? {})) {
				if (key.endsWith("color")) expect(tokens).toContain(value)
			}
		}
		expect(navyStyle(original, css.replace("#8a90a8", "#123456")).layers).not.toEqual(style.layers)
		expect(() => navyStyle(original, "")).toThrow("Missing map color token: z0")
	})
})
