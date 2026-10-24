import { readFileSync } from "node:fs"
import type { StyleSpecification } from "maplibre-gl"
import { describe, expect, it } from "vitest"
import style from "@/public/map/navy.json"
import { navyStyle } from "./map-style"

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")

describe("navy map style", () => {
	it("only references verified OpenFreeMap sprite images", () => {
		const verifiedImages = ["", "circle_11", "oneway"]
		for (const layer of style.layers) {
			for (const properties of [layer.paint, layer.layout]) {
				for (const [key, value] of Object.entries(properties ?? {})) {
					if (!["fill-pattern", "icon-image", "background-pattern"].includes(key)) continue
					if (typeof value === "string") expect(verifiedImages, layer.id).toContain(value)
					else {
						expect(Array.isArray(value), layer.id).toBe(true)
						if (Array.isArray(value)) {
							expect(value.slice(0, 2), layer.id).toEqual(["step", ["zoom"]])
							for (let i = 2; i < value.length; i += 2) expect(verifiedImages, layer.id).toContain(value[i])
						}
					}
				}
			}
		}
	})

	it("keeps every remote URL on OpenFreeMap, including source tiles, glyphs and sprites", () => {
		const urls = JSON.stringify(style).match(/https?:\/\/[^"\s]+/g) ?? []
		expect(urls.length).toBeGreaterThanOrEqual(4)
		for (const url of urls) expect(new URL(url).hostname).toBe("tiles.openfreemap.org")
		expect(style.sources.openmaptiles.url).toBe("https://tiles.openfreemap.org/planet")
	})

	it("uses runtime tokens, preserves source assets, and declares attribution exactly once", () => {
		const original = structuredClone(style) as StyleSpecification
		for (const layer of original.layers) {
			if (layer.type === "fill" && layer.id === "landcover_wood") {
				layer.paint = { ...layer.paint, "fill-pattern": "wood-pattern" }
			}
			if (layer.type === "symbol" && Array.isArray(layer.layout?.["icon-image"])) {
				layer.layout["icon-image"][2] = "circle-11"
			}
		}
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
