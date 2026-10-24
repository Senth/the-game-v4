import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useLocationReporter } from "./use-location-reporter"

const hooks = vi.hoisted(() => ({ effects: [] as EffectCallback[], setStatus: vi.fn() }))
vi.mock("react", async (importOriginal) => {
	const react = await importOriginal<typeof import("react")>()
	return {
		...react,
		useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
		useEffectEvent: (callback: unknown) => callback,
		useState: (initial: unknown) => [initial, hooks.setStatus],
	}
})

const changed = vi.fn()
let reporter: ReturnType<typeof useLocationReporter>
function Harness({ questId }: { questId: string | null }) {
	reporter = useLocationReporter(questId, changed)
	return null
}

let cleanup: (() => void)[] = []
let position: PositionCallback
let error: PositionErrorCallback
let permission: EventTarget & { state: PermissionState }
const clearWatch = vi.fn()
const watchPosition = vi.fn()
const release = vi.fn()
const request = vi.fn()
const query = vi.fn()
const send = vi.fn()

async function mount(questId: string | null = "place-quest") {
	hooks.effects.length = 0
	renderToStaticMarkup(<Harness questId={questId} />)
	cleanup = hooks.effects.map((effect) => effect()).filter((value): value is () => void => !!value)
	await vi.advanceTimersByTimeAsync(0)
}

function fix(accuracy = 12) {
	position({ coords: { latitude: 55.5, longitude: 13.2, accuracy }, timestamp: Date.now() } as GeolocationPosition)
}

function visible(hidden: boolean) {
	Object.assign(document, { hidden })
	document.dispatchEvent(new Event("visibilitychange"))
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(new Date("2026-10-23T12:00:00Z"))
	vi.resetAllMocks()
	permission = Object.assign(new EventTarget(), { state: "granted" as PermissionState })
	query.mockResolvedValue(permission)
	release.mockResolvedValue(undefined)
	request.mockResolvedValue({ release })
	send.mockResolvedValue({ ok: true, json: async () => ({ status: "outside" }) })
	watchPosition.mockImplementation((onPosition, onError) => {
		position = onPosition
		error = onError
		return watchPosition.mock.calls.length
	})
	vi.stubGlobal("navigator", {
		geolocation: { watchPosition, clearWatch },
		permissions: { query },
		wakeLock: { request },
	})
	vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }))
	vi.stubGlobal("fetch", send)
})

afterEach(() => {
	for (const stop of cleanup) stop()
	cleanup = []
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe("useLocationReporter", () => {
	it("starts granted permission at once, sends bounded fixes and throttles to five seconds", async () => {
		await mount()
		expect(query).toHaveBeenCalledWith({ name: "geolocation" })
		expect(watchPosition).toHaveBeenCalledWith(
			expect.any(Function),
			expect.any(Function),
			expect.objectContaining({ enableHighAccuracy: true }),
		)
		fix()
		await vi.advanceTimersByTimeAsync(0)
		expect(send).toHaveBeenCalledOnce()
		const [url, options] = send.mock.calls[0] ?? []
		expect(url).toBe("/api/location")
		expect(options.method).toBe("POST")
		expect(JSON.parse(options.body)).toEqual({
			questId: "place-quest",
			lat: 55.5,
			lng: 13.2,
			accuracy: 12,
			at: Date.now(),
		})
		await vi.advanceTimersByTimeAsync(4999)
		fix()
		expect(send).toHaveBeenCalledOnce()
		await vi.advanceTimersByTimeAsync(1)
		fix(70)
		await vi.advanceTimersByTimeAsync(0)
		expect(send).toHaveBeenCalledTimes(2)
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "rough", accuracy: 70 })
	})

	it("waits for Share location when permission prompts or cannot be queried", async () => {
		permission.state = "prompt"
		await mount()
		expect(watchPosition).not.toHaveBeenCalled()
		reporter.share()
		expect(watchPosition).toHaveBeenCalledOnce()
		for (const stop of cleanup) stop()
		query.mockRejectedValue(new Error("Unsupported permission query"))
		await mount()
		expect(watchPosition).toHaveBeenCalledOnce()
		reporter.share()
		expect(watchPosition).toHaveBeenCalledTimes(2)
	})

	it("shows blocked for denied permission and geolocation denial", async () => {
		permission.state = "denied"
		await mount()
		expect(watchPosition).not.toHaveBeenCalled()
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "blocked" })
		permission.state = "granted"
		permission.dispatchEvent(new Event("change"))
		expect(watchPosition).toHaveBeenCalledOnce()
		error({ code: 1 } as GeolocationPositionError)
		expect(clearWatch).toHaveBeenCalledWith(1)
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "blocked" })
	})

	it.each(["stop", "solved"])("stops watch, requests and wake lock on %s reply", async (status) => {
		send.mockResolvedValue({ ok: true, json: async () => ({ status, pointsEarned: 15 }) })
		await mount()
		fix()
		await vi.advanceTimersByTimeAsync(0)
		expect(clearWatch).toHaveBeenCalledWith(1)
		expect(release).toHaveBeenCalledOnce()
		expect(changed).toHaveBeenCalledOnce()
		visible(true)
		visible(false)
		expect(watchPosition).toHaveBeenCalledOnce()
	})

	it("pauses hidden tabs, aborts in-flight requests, resumes and cleans up on quest change", async () => {
		send.mockImplementation(() => new Promise(() => {}))
		await mount()
		expect(request).toHaveBeenCalledWith("screen")
		fix()
		const signal = send.mock.lastCall?.[1].signal as AbortSignal
		visible(true)
		expect(signal.aborted).toBe(true)
		expect(clearWatch).toHaveBeenCalledWith(1)
		expect(release).toHaveBeenCalledOnce()
		visible(false)
		await vi.advanceTimersByTimeAsync(0)
		expect(watchPosition).toHaveBeenCalledTimes(2)
		expect(request).toHaveBeenCalledTimes(2)
		for (const stop of cleanup) stop()
		await mount("next-place")
		expect(clearWatch).toHaveBeenCalledWith(2)
		expect(release).toHaveBeenCalledTimes(2)
		expect(watchPosition).toHaveBeenCalledTimes(3)
	})

	it("ignores stale callbacks and responses after cleanup", async () => {
		let finish!: (value: unknown) => void
		send.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve
			}),
		)
		await mount()
		fix()
		for (const stop of cleanup) stop()
		cleanup = []
		hooks.setStatus.mockClear()
		fix()
		finish({ ok: true, json: async () => ({ status: "solved", pointsEarned: 15 }) })
		await vi.advanceTimersByTimeAsync(0)
		expect(changed).not.toHaveBeenCalled()
		expect(hooks.setStatus).not.toHaveBeenCalled()
		expect(send).toHaveBeenCalledOnce()
	})

	it("does not start hidden, then starts on becoming visible", async () => {
		visible(true)
		await mount()
		expect(watchPosition).not.toHaveBeenCalled()
		expect(request).not.toHaveBeenCalled()
		visible(false)
		await vi.advanceTimersByTimeAsync(0)
		expect(watchPosition).toHaveBeenCalledOnce()
		expect(request).toHaveBeenCalledOnce()
	})

	it("releases wake lock that resolves after hiding", async () => {
		let finish!: (value: unknown) => void
		request.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve
			}),
		)
		await mount()
		visible(true)
		finish({ release })
		await vi.advanceTimersByTimeAsync(0)
		expect(release).toHaveBeenCalledOnce()
	})

	it("ignores wake-lock failures and supports missing browser APIs", async () => {
		request.mockRejectedValue(new Error("Wake lock unavailable"))
		await mount()
		expect(watchPosition).toHaveBeenCalledOnce()
		for (const stop of cleanup) stop()
		vi.stubGlobal("navigator", {})
		await mount()
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "unavailable" })
	})

	it("does nothing outside current location quest", async () => {
		await mount(null)
		expect(query).not.toHaveBeenCalled()
		expect(request).not.toHaveBeenCalled()
		expect(watchPosition).not.toHaveBeenCalled()
	})
})
