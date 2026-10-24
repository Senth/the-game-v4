import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useMyPosition } from "./use-my-position"

const hooks = vi.hoisted(() => ({ effects: [] as EffectCallback[], setStatus: vi.fn() }))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
	useEffectEvent: (callback: unknown) => callback,
	useState: (initial: unknown) => [initial, hooks.setStatus],
}))

const watchPosition = vi.fn<Geolocation["watchPosition"]>(() => 7)
const clearWatch = vi.fn()
const onPosition = vi.fn()
let position: ReturnType<typeof useMyPosition>
let cleanup: (() => void)[] = []

function Harness({ enabled }: { enabled: boolean }) {
	position = useMyPosition(enabled, onPosition)
	return null
}

function mount(enabled = true) {
	hooks.effects = []
	renderToStaticMarkup(<Harness enabled={enabled} />)
	cleanup = hooks.effects.map((effect) => effect()).filter((value): value is () => void => !!value)
}

function fix(accuracy: number, lat = 55.12345678, lng = 13.12345678) {
	const success = watchPosition.mock.calls[0]?.[0] as unknown as PositionCallback
	success({ coords: { latitude: lat, longitude: lng, accuracy } } as GeolocationPosition)
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.clearAllMocks()
	vi.stubGlobal("navigator", { geolocation: { watchPosition, clearWatch } })
})

afterEach(() => {
	for (const stop of cleanup) stop()
	cleanup = []
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

it("starts only on tap, reports rough accuracy, accepts the first fix at most 50 m and clears its watch", () => {
	mount()
	expect(watchPosition).not.toHaveBeenCalled()
	position.start()
	expect(watchPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
		enableHighAccuracy: true,
		maximumAge: 0,
		timeout: 30_000,
	})
	fix(75.6)
	expect(hooks.setStatus).toHaveBeenLastCalledWith({ waiting: true, accuracy: 76, error: null })
	expect(onPosition).not.toHaveBeenCalled()
	fix(50)
	expect(onPosition).toHaveBeenCalledExactlyOnceWith({ lat: 55.123457, lng: 13.123457 })
	expect(clearWatch).toHaveBeenCalledExactlyOnceWith(7)
	fix(5)
	vi.advanceTimersByTime(30_000)
	expect(onPosition).toHaveBeenCalledOnce()
	expect(hooks.setStatus).toHaveBeenLastCalledWith({ waiting: false, accuracy: null, error: null })
})

it.each(["cancel", "unmount", "timeout"])("clears the watcher on %s and ignores late fixes", (action) => {
	mount()
	position.start()
	if (action === "cancel") position.cancel()
	else if (action === "timeout") {
		vi.advanceTimersByTime(29_999)
		expect(clearWatch).not.toHaveBeenCalled()
		vi.advanceTimersByTime(1)
		expect(hooks.setStatus).toHaveBeenLastCalledWith({
			waiting: false,
			accuracy: null,
			error: "Couldn't get within 50 m. Try outside.",
		})
	} else {
		for (const stop of cleanup) stop()
		cleanup = []
	}
	expect(clearWatch).toHaveBeenCalledExactlyOnceWith(7)
	fix(1)
	expect(onPosition).not.toHaveBeenCalled()
})

it.each([
	[1, "Location blocked. Allow it for this site, then try again."],
	[2, "Location unavailable. Try again outside."],
	[3, "Couldn't get within 50 m. Try outside."],
])("handles geolocation error %s", (code, error) => {
	mount()
	position.start()
	const fail = watchPosition.mock.calls[0]?.[1] as unknown as PositionErrorCallback
	fail({ code } as GeolocationPositionError)
	expect(hooks.setStatus).toHaveBeenLastCalledWith({ waiting: false, accuracy: null, error })
	expect(clearWatch).toHaveBeenCalledWith(7)
	fix(5)
	expect(onPosition).not.toHaveBeenCalled()
})

it("handles missing geolocation without requesting permission", () => {
	vi.stubGlobal("navigator", {})
	mount()
	position.start()
	expect(hooks.setStatus).toHaveBeenLastCalledWith({
		waiting: false,
		accuracy: null,
		error: "This browser can't share location.",
	})
})

it("does not start when locked and prevents duplicate watches", () => {
	mount(false)
	position.start()
	expect(watchPosition).not.toHaveBeenCalled()
	for (const stop of cleanup) stop()
	mount()
	position.start()
	position.start()
	expect(watchPosition).toHaveBeenCalledOnce()
})

it("ignores callbacks from a canceled watch after starting again", () => {
	mount()
	position.start()
	position.cancel()
	position.start()
	fix(5)
	expect(onPosition).not.toHaveBeenCalled()
	const success = watchPosition.mock.calls[1]?.[0]
	success?.({ coords: { latitude: 55, longitude: 13, accuracy: 10 } } as GeolocationPosition)
	expect(onPosition).toHaveBeenCalledExactlyOnceWith({ lat: 55, lng: 13 })
})

it("handles a synchronous browser exception without leaving a timer", () => {
	watchPosition.mockImplementationOnce(() => {
		throw new Error("Unavailable")
	})
	mount()
	position.start()
	expect(hooks.setStatus).toHaveBeenLastCalledWith({
		waiting: false,
		accuracy: null,
		error: "This browser can't share location.",
	})
	expect(vi.getTimerCount()).toBe(0)
})
