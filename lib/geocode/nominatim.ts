import { z } from "zod"

const requestIntervalMs = 1000
const cacheDurationMs = 24 * 60 * 60 * 1000
const userAgent = "the-game-v4 (https://game.senth.org)"

const NominatimItem = z.object({
	lat: z.string(),
	lon: z.string(),
	name: z.string().optional(),
	display_name: z.string().min(1),
	boundingbox: z.tuple([z.string(), z.string(), z.string(), z.string()]),
})
const NominatimResponse = z.array(NominatimItem)

export type PlaceSearchResult = {
	name: string
	label: string
	lat: number
	lng: number
	bbox: [string, string, string, string]
}

export type NominatimSearchResult =
	| { ok: true; results: PlaceSearchResult[] }
	| { ok: false; error: "invalid-query" | "unavailable" }

export function createNominatimSearch(fetcher: typeof fetch, clock: () => number) {
	let nextRequestAt = 0
	let queue = Promise.resolve()
	const cache = new Map<string, { expiresAt: number; result: NominatimSearchResult }>()
	const pending = new Map<string, Promise<NominatimSearchResult>>()

	function request(url: URL): Promise<Response> {
		const next = queue.then(async () => {
			const delay = nextRequestAt - clock()
			if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay))
			nextRequestAt = clock() + requestIntervalMs
			return fetcher(url.toString(), { headers: { "User-Agent": userAgent } })
		})
		queue = next.then(
			() => {},
			() => {},
		)
		return next
	}

	return async function searchNominatim(query: string): Promise<NominatimSearchResult> {
		if (typeof query !== "string") return { ok: false, error: "invalid-query" }
		const trimmed = query.trim()
		if (trimmed.length < 2 || trimmed.length > 200) return { ok: false, error: "invalid-query" }

		const key = trimmed.toLowerCase()
		const now = clock()
		const cached = cache.get(key)
		if (cached && cached.expiresAt > now) return cached.result
		if (cached) cache.delete(key)
		const inProgress = pending.get(key)
		if (inProgress) return inProgress

		const url = new URL("https://nominatim.openstreetmap.org/search")
		url.search = new URLSearchParams({
			format: "jsonv2",
			limit: "5",
			"accept-language": "sv",
			q: trimmed,
		}).toString()
		const search = (async (): Promise<NominatimSearchResult> => {
			try {
				const response = await request(url)
				if (!response.ok) return { ok: false, error: "unavailable" }
				const parsed = NominatimResponse.safeParse(await response.json())
				if (!parsed.success) return { ok: false, error: "unavailable" }
				const results: PlaceSearchResult[] = parsed.data.slice(0, 5).map((item) => {
					const lat = Number(item.lat)
					const lng = Number(item.lon)
					if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new TypeError("Invalid Nominatim coordinates")
					return {
						name: item.name?.trim() || item.display_name,
						label: item.display_name,
						lat,
						lng,
						bbox: [...item.boundingbox],
					}
				})
				const result: NominatimSearchResult = { ok: true, results }
				cache.set(key, { expiresAt: clock() + cacheDurationMs, result })
				return result
			} catch {
				return { ok: false, error: "unavailable" }
			}
		})()
		pending.set(key, search)
		try {
			return await search
		} finally {
			pending.delete(key)
		}
	}
}

export const searchNominatim = createNominatimSearch(fetch, Date.now)
