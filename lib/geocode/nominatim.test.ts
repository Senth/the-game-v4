import { afterEach, describe, expect, it, vi } from "vitest"
import { createNominatimSearch } from "./nominatim"

const fixture = [
	{
		lat: "55.5079",
		lon: "13.2353",
		name: "Svedala",
		display_name: "Svedala, Skåne län, Sverige",
		boundingbox: ["55.49", "55.52", "13.21", "13.26"],
	},
	{
		lat: "55.6",
		lon: "13.3",
		display_name: "Nearby place, Sverige",
		boundingbox: ["55.5", "55.7", "13.2", "13.4"],
	},
]

afterEach(() => {
	vi.useRealTimers()
})

describe("Nominatim search", () => {
	it("maps saved Nominatim results and sends the shared URL and User-Agent", async () => {
		const fetcher = vi.fn<typeof fetch>(async () => Response.json(fixture))
		const search = createNominatimSearch(fetcher, Date.now)

		expect(await search("  Svedala  ")).toEqual({
			ok: true,
			results: [
				{
					name: "Svedala",
					label: "Svedala, Skåne län, Sverige",
					lat: 55.5079,
					lng: 13.2353,
					bbox: ["55.49", "55.52", "13.21", "13.26"],
				},
				{
					name: "Nearby place, Sverige",
					label: "Nearby place, Sverige",
					lat: 55.6,
					lng: 13.3,
					bbox: ["55.5", "55.7", "13.2", "13.4"],
				},
			],
		})
		const call = fetcher.mock.calls[0]
		if (!call) throw new Error("Nominatim fetch was not called")
		const [input, options] = call
		const url = new URL(String(input))
		expect(url.origin).toBe("https://nominatim.openstreetmap.org")
		expect(url.pathname).toBe("/search")
		expect(Object.fromEntries(url.searchParams)).toEqual({
			format: "jsonv2",
			limit: "5",
			"accept-language": "sv",
			q: "Svedala",
		})
		expect(options?.headers).toEqual({ "User-Agent": "the-game-v4 (https://game.senth.org)" })
	})

	it("returns empty results and typed HTTP failures", async () => {
		const empty = createNominatimSearch(
			vi.fn(async () => Response.json([])),
			Date.now,
		)
		const failed = createNominatimSearch(
			vi.fn(async () => new Response(null, { status: 503 })),
			Date.now,
		)

		expect(await empty("Svedala")).toEqual({ ok: true, results: [] })
		expect(await failed("Svedala")).toEqual({ ok: false, error: "unavailable" })
	})

	it("caches normalized queries for 24 hours", async () => {
		vi.useFakeTimers()
		vi.setSystemTime(0)
		const fetcher = vi.fn(async () => Response.json(fixture))
		const search = createNominatimSearch(fetcher, Date.now)

		await search("Svedala")
		await search("  sVeDaLa  ")
		expect(fetcher).toHaveBeenCalledTimes(1)

		await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
		await search("Svedala")
		expect(fetcher).toHaveBeenCalledTimes(2)
	})

	it("spaces request starts at least one second apart", async () => {
		vi.useFakeTimers()
		vi.setSystemTime(0)
		const started: number[] = []
		const fetcher = vi.fn(async () => {
			started.push(Date.now())
			return Response.json([])
		})
		const search = createNominatimSearch(fetcher, Date.now)
		const first = search("first")
		await vi.advanceTimersByTimeAsync(0)
		expect(fetcher).toHaveBeenCalledTimes(1)
		const second = search("second")

		await vi.advanceTimersByTimeAsync(999)
		expect(fetcher).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1)
		await Promise.all([first, second])
		expect(started).toEqual([0, 1000])
	})

	it.each(["", " ", "x", "x".repeat(201)])("rejects query outside trimmed bounds: %j", async (query) => {
		const fetcher = vi.fn(async () => Response.json([]))
		const search = createNominatimSearch(fetcher, Date.now)

		expect(await search(query)).toEqual({ ok: false, error: "invalid-query" })
		expect(fetcher).not.toHaveBeenCalled()
	})
})
