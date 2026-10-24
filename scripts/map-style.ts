import { readFile, writeFile } from "node:fs/promises"
import type { StyleSpecification } from "maplibre-gl"

export function navyStyle(style: StyleSpecification, css: string): StyleSpecification {
	const tokens = Object.fromEntries(
		[...css.matchAll(/--color-([\w-]+):\s*(#[\da-f]+);/gi)].map(([, name, value]) => [name, value]),
	)
	const color = (name: string) => {
		const value = tokens[name]
		if (!value) throw new Error(`Missing map color token: ${name}`)
		return value
	}
	const navy = structuredClone(style)
	for (const source of Object.values(navy.sources)) {
		if (source.type === "vector" || source.type === "raster") {
			source.attribution = source.type === "vector" ? "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" : ""
		}
	}
	for (const layer of navy.layers) {
		const id = layer.id
		if (layer.type === "background") layer.paint = { ...layer.paint, "background-color": color("z0") }
		else if (layer.type === "fill") {
			if (layer.paint?.["fill-pattern"] === "wood-pattern") delete layer.paint["fill-pattern"]
			layer.paint = {
				...layer.paint,
				"fill-color": color(/water/.test(id) ? "z1" : "field"),
				"fill-opacity": 1,
				...(/building/.test(id) ? { "fill-outline-color": color("z2") } : {}),
			}
		} else if (layer.type === "line") {
			layer.paint = {
				...layer.paint,
				"line-color": color(
					/casing/.test(id) ? "z0" : /waterway/.test(id) ? "z1" : /rail|major|motorway/.test(id) ? "muted" : "z2",
				),
			}
		} else if (layer.type === "symbol") {
			const icon = layer.layout?.["icon-image"]
			if (Array.isArray(icon) && icon[0] === "step" && icon[2] === "circle-11") icon[2] = "circle_11"
			layer.paint = {
				...layer.paint,
				"text-color": color("muted"),
				"text-halo-color": color("z0"),
				"text-halo-width": 1.5,
			}
		}
	}
	return navy
}

async function main() {
	const response = await fetch("https://tiles.openfreemap.org/styles/dark")
	if (!response.ok) throw new Error(`OpenFreeMap style request failed: ${response.status}`)
	const style = (await response.json()) as StyleSpecification
	const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8")
	await writeFile(
		new URL("../public/map/navy.json", import.meta.url),
		`${JSON.stringify(navyStyle(style, css), null, "\t")}\n`,
	)
}

if (import.meta.filename === process.argv[1]) {
	main().catch((error) => {
		console.error(error)
		process.exitCode = 1
	})
}
