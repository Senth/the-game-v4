import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useCompass } from "./use-compass"

const hooks = vi.hoisted(() => ({ effects: [] as EffectCallback[], setStatus: vi.fn() }))
vi.mock("react", async (importOriginal) => {
	const react = await importOriginal<typeof import("react")>()
	return {
		...react,
		useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
		useState: (initial: unknown) => [initial, hooks.setStatus],
	}
})

let compass: ReturnType<typeof useCompass>
let cleanup: (() => void)[] = []
let browser: EventTarget
const permission = vi.fn()

function Harness({ questId }: { questId: string | null }) {
	compass = useCompass(questId)
	return null
}

function mount(questId: string | null = "place-quest") {
	hooks.effects.length = 0
	renderToStaticMarkup(<Harness questId={questId} />)
	cleanup = hooks.effects.map((effect) => effect()).filter((value): value is () => void => !!value)
}

function reading(
	values: { alpha?: number | null; absolute?: boolean; webkitCompassHeading?: number },
	type = "deviceorientationabsolute",
) {
	browser.dispatchEvent(Object.assign(new Event(type), values))
}

function visible(hidden: boolean) {
	Object.assign(document, { hidden })
	document.dispatchEvent(new Event("visibilitychange"))
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.resetAllMocks()
	browser = new EventTarget()
	vi.stubGlobal("window", browser)
	vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }))
	vi.stubGlobal("screen", { orientation: { angle: 0 } })
	vi.stubGlobal("DeviceOrientationEvent", class {})
	vi.stubGlobal("navigator", {})
	permission.mockResolvedValue("granted")
})

afterEach(() => {
	for (const stop of cleanup) stop()
	cleanup = []
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe("useCompass", () => {
	it.each([
		[0, 0],
		[90, 270],
		[270, 90],
		[360, 0],
	])("converts Android alpha %s to magnetic heading %s", (alpha, heading) => {
		mount()
		reading({ alpha })
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "on", heading })
	})

	it("subtracts landscape angle and wraps negative headings", () => {
		Object.assign(screen.orientation, { angle: 90 })
		mount()
		reading({ alpha: 0 })
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "on", heading: 270 })
	})

	it("smooths across north instead of turning through south", () => {
		mount()
		reading({ alpha: 1 })
		reading({ alpha: 359 })
		const heading = hooks.setStatus.mock.lastCall?.[0].heading as number
		expect(heading > 358 || heading < 2).toBe(true)
	})

	it("requests iPhone permission only from a tap and reads webkitCompassHeading", async () => {
		vi.stubGlobal("DeviceOrientationEvent", { requestPermission: permission })
		mount()
		expect(permission).not.toHaveBeenCalled()
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "needsTap" })
		compass.request()
		expect(permission).toHaveBeenCalledOnce()
		await vi.advanceTimersByTimeAsync(0)
		reading({ webkitCompassHeading: 45, alpha: 180 }, "deviceorientation")
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "on", heading: 45 })
		await vi.advanceTimersByTimeAsync(2000)
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "on", heading: 45 })
	})

	it.each([false, true])("reads Chromium absolute alpha with requestPermission, tapped: %s", async (tapped) => {
		vi.stubGlobal("DeviceOrientationEvent", { requestPermission: permission })
		mount()
		if (tapped) {
			compass.request()
			await vi.advanceTimersByTimeAsync(0)
		}
		reading({ alpha: 90 })
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "on", heading: 270 })
		await vi.advanceTimersByTimeAsync(2000)
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "on", heading: 270 })
		if (!tapped) expect(permission).not.toHaveBeenCalled()
	})

	it("does not need a tap when Chromium sensor permissions are already granted, even without readings", async () => {
		vi.stubGlobal("DeviceOrientationEvent", { requestPermission: permission })
		const query = vi.fn().mockResolvedValue({ state: "granted" })
		vi.stubGlobal("navigator", { permissions: { query } })
		mount()
		await vi.advanceTimersByTimeAsync(0)
		expect(query.mock.calls).toEqual([[{ name: "accelerometer" }], [{ name: "gyroscope" }], [{ name: "magnetometer" }]])
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "none" })
		await vi.advanceTimersByTimeAsync(2000)
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "none" })
		expect(permission).not.toHaveBeenCalled()
	})

	it.each(["prompt", "denied"])("handles queried sensor permission %s", async (state) => {
		vi.stubGlobal("DeviceOrientationEvent", { requestPermission: permission })
		vi.stubGlobal("navigator", {
			permissions: {
				query: vi
					.fn()
					.mockImplementation(({ name }) => Promise.resolve({ state: name === "magnetometer" ? state : "granted" })),
			},
		})
		mount()
		await vi.advanceTimersByTimeAsync(2000)
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: state === "prompt" ? "needsTap" : "refused" })
		expect(permission).not.toHaveBeenCalled()
		if (state === "denied") {
			reading({ alpha: 90 })
			expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "refused" })
		}
	})

	it.each(["reading", "hidden", "cleanup"])("ignores late sensor permission queries after %s", async (action) => {
		let finish!: (value: { state: string }) => void
		const pending = new Promise((resolve) => {
			finish = resolve
		})
		vi.stubGlobal("DeviceOrientationEvent", { requestPermission: permission })
		vi.stubGlobal("navigator", { permissions: { query: vi.fn().mockReturnValue(pending) } })
		mount()
		if (action === "reading") reading({ alpha: 90 })
		else if (action === "hidden") visible(true)
		else {
			for (const stop of cleanup) stop()
			cleanup = []
		}
		hooks.setStatus.mockClear()
		finish({ state: "granted" })
		await vi.advanceTimersByTimeAsync(2000)
		expect(hooks.setStatus).not.toHaveBeenCalled()
	})

	it("keeps tap-only permission available when sensor permission queries are unsupported", async () => {
		vi.stubGlobal("DeviceOrientationEvent", { requestPermission: permission })
		vi.stubGlobal("navigator", {
			permissions: { query: vi.fn().mockRejectedValue(new TypeError("Unsupported permission")) },
		})
		mount()
		await vi.advanceTimersByTimeAsync(2000)
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "needsTap" })
		expect(permission).not.toHaveBeenCalled()
		compass.request()
		await vi.advanceTimersByTimeAsync(2000)
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "none" })
	})

	it.each([false, true])(
		"accepts webkitCompassHeading independently of permission API presence: %s",
		(hasPermission) => {
			if (hasPermission) vi.stubGlobal("DeviceOrientationEvent", { requestPermission: permission })
			mount()
			reading({ webkitCompassHeading: 45, alpha: 180 }, "deviceorientation")
			expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "on", heading: 45 })
		},
	)

	it("ignores relative alpha but accepts explicitly absolute deviceorientation", () => {
		mount()
		reading({ alpha: 90, absolute: false }, "deviceorientation")
		expect(hooks.setStatus).not.toHaveBeenCalledWith(expect.objectContaining({ state: "on" }))
		reading({ alpha: 90, absolute: true }, "deviceorientation")
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "on", heading: 270 })
	})

	it.each(["denied", "error"])("handles iPhone permission %s without listening", async (result) => {
		vi.stubGlobal("DeviceOrientationEvent", { requestPermission: permission })
		if (result === "error") permission.mockRejectedValue(new Error("Motion unavailable"))
		else permission.mockResolvedValue(result)
		mount()
		compass.request()
		await vi.advanceTimersByTimeAsync(0)
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "refused" })
		reading({ webkitCompassHeading: 45 }, "deviceorientation")
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "refused" })
	})

	it("falls back with missing API or no usable reading within two seconds", async () => {
		mount()
		reading({ alpha: null })
		reading({ alpha: Number.NaN })
		await vi.advanceTimersByTimeAsync(1999)
		expect(hooks.setStatus).not.toHaveBeenCalledWith(expect.objectContaining({ state: "on" }))
		await vi.advanceTimersByTimeAsync(1)
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "none" })
		for (const stop of cleanup) stop()
		vi.stubGlobal("DeviceOrientationEvent", undefined)
		mount()
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "none" })
		compass.request()
	})

	it("pauses hidden pages, resets smoothing on resume and removes listeners on quest change and unmount", () => {
		const remove = vi.spyOn(browser, "removeEventListener")
		mount()
		reading({ alpha: 90 })
		visible(true)
		expect(remove).toHaveBeenCalledWith("deviceorientation", expect.any(Function))
		expect(remove).toHaveBeenCalledWith("deviceorientationabsolute", expect.any(Function))
		hooks.setStatus.mockClear()
		reading({ alpha: 180 })
		expect(hooks.setStatus).not.toHaveBeenCalled()
		visible(false)
		reading({ alpha: 180 })
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "on", heading: 180 })
		for (const stop of cleanup) stop()
		mount("next-place")
		reading({ alpha: 0 })
		expect(hooks.setStatus).toHaveBeenLastCalledWith({ state: "on", heading: 0 })
		for (const stop of cleanup) stop()
		cleanup = []
		hooks.setStatus.mockClear()
		reading({ alpha: 90 })
		reading({ webkitCompassHeading: 45 }, "deviceorientation")
		expect(hooks.setStatus).not.toHaveBeenCalled()
	})

	it("ignores permission resolving after hide or cleanup", async () => {
		let finish!: (value: string) => void
		permission.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve
			}),
		)
		vi.stubGlobal("DeviceOrientationEvent", { requestPermission: permission })
		mount()
		compass.request()
		visible(true)
		for (const stop of cleanup) stop()
		cleanup = []
		hooks.setStatus.mockClear()
		finish("granted")
		await vi.advanceTimersByTimeAsync(2000)
		reading({ webkitCompassHeading: 45 }, "deviceorientation")
		expect(hooks.setStatus).not.toHaveBeenCalled()
	})

	it("does not listen outside a warmer quest or while initially hidden", () => {
		const add = vi.spyOn(browser, "addEventListener")
		mount(null)
		compass.request()
		expect(add).not.toHaveBeenCalled()
		visible(true)
		mount()
		expect(add).not.toHaveBeenCalled()
		visible(false)
		expect(add).toHaveBeenCalledWith("deviceorientationabsolute", expect.any(Function))
	})
})
