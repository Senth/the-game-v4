import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { circleRing, edgePoint } from "@/lib/domain/map"
import navy from "@/public/map/navy.json"
import LazyMap from "./lazy-map"
import MapView, { type MapViewProps } from "./map-view"

const hooks = vi.hoisted(() => ({
	effects: [] as EffectCallback[],
	refs: [] as { current: unknown }[],
	index: 0,
	eventIndex: 0,
	events: [] as { callback: (...args: never[]) => unknown; stable: (...args: never[]) => unknown }[],
}))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
	useEffectEvent: (callback: (...args: never[]) => unknown) => {
		const index = hooks.eventIndex++
		const event = hooks.events[index] ?? {
			callback,
			stable: (...args: never[]) => hooks.events[index]?.callback(...args),
		}
		hooks.events[index] = event
		event.callback = callback
		return event.stable
	},
	useRef: (initial: unknown) => {
		const index = hooks.index++
		hooks.refs[index] ??= { current: initial }
		return hooks.refs[index]
	},
}))

const fake = vi.hoisted(() => {
	const handler = () => ({ enable: vi.fn(), disable: vi.fn(), disableRotation: vi.fn() })
	const setWorkerUrl = vi.fn()
	class FakeMap {
		static instances: FakeMap[] = []
		events: Record<string, (event: never) => void> = {}
		sources: Record<string, { setData: ReturnType<typeof vi.fn> }> = {}
		dragPan = handler()
		scrollZoom = handler()
		boxZoom = handler()
		doubleClickZoom = handler()
		touchZoomRotate = handler()
		keyboard = handler()
		addSource = vi.fn((id: string) => {
			this.sources[id] = { setData: vi.fn() }
		})
		getSource = vi.fn((id: string) => this.sources[id])
		addLayer = vi.fn()
		fitBounds = vi.fn()
		jumpTo = vi.fn()
		getCenter = vi.fn(() => ({ lat: 55.12345678, lng: 13.12345678 }))
		getZoom = vi.fn(() => 15.6789)
		remove = vi.fn()
		workerUrl = setWorkerUrl.mock.lastCall?.[0]
		constructor(public options: unknown) {
			FakeMap.instances.push(this)
		}
		on(name: string, callback: (event: never) => void) {
			this.events[name] = callback
			return this
		}
		fire(name: string, event = {}) {
			this.events[name]?.(event as never)
		}
	}
	class Marker {
		static instances: Marker[] = []
		events: Record<string, () => void> = {}
		position = { lng: 0, lat: 0 }
		setLngLat = vi.fn(([lng, lat]: [number, number]) => {
			this.position = { lng, lat }
			return this
		})
		getLngLat = vi.fn(() => this.position)
		getElement = () => this.options.element
		addTo = vi.fn(() => this)
		setDraggable = vi.fn(() => this)
		remove = vi.fn()
		constructor(public options: { element: HTMLElement; draggable: boolean }) {
			Marker.instances.push(this)
		}
		on(name: string, callback: () => void) {
			this.events[name] = callback
			return this
		}
	}
	return { Map: FakeMap, Marker, setWorkerUrl }
})
vi.mock("maplibre-gl", () => fake)

const lazy = vi.hoisted(() => ({
	loader: null as null | (() => Promise<unknown>),
	options: {} as { ssr?: boolean; loading?: () => React.ReactNode },
}))
vi.mock("next/dynamic", () => ({
	default: (loader: () => Promise<unknown>, options: typeof lazy.options) => {
		lazy.loader = loader
		lazy.options = options
		return () => options.loading?.()
	},
}))

const circle = { lat: 55.5, lng: 13.2, radius: 40 }
const dot = { lat: 55.501, lng: 13.201, accuracy: 80 }
const framing = {
	bounds: [
		[13.19, 55.49],
		[13.21, 55.51],
	] as [[number, number], [number, number]],
}
let cleanup: (() => void)[] = []

function render(props: MapViewProps) {
	hooks.index = 0
	hooks.eventIndex = 0
	hooks.effects = []
	return renderToStaticMarkup(<MapView {...props} />)
}

function mount(props: MapViewProps = {}) {
	const html = render(props)
	const container = hooks.refs[0]
	if (container) container.current = {}
	cleanup = hooks.effects.map((effect) => effect()).filter((value): value is () => void => !!value)
	const map = fake.Map.instances[0] as InstanceType<typeof fake.Map>
	return { map, html }
}

beforeEach(() => {
	vi.clearAllMocks()
	hooks.refs = []
	hooks.events = []
	fake.Map.instances = []
	fake.Marker.instances = []
	vi.stubGlobal("document", {
		createElement: () => ({ className: "", dataset: {}, setAttribute: vi.fn(), append: vi.fn() }),
	})
	vi.stubGlobal("getComputedStyle", () => ({
		getPropertyValue: (key: string) => (key === "--color-head" ? "#bbdefb" : "#1c7dc8"),
	}))
})

afterEach(() => {
	for (const stop of cleanup) stop()
	cleanup = []
	vi.unstubAllGlobals()
})

describe("MapView", () => {
	it("configures a bundled worker URL before constructing a map", () => {
		const { map } = mount()
		expect(fake.setWorkerUrl).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("maplibre-gl-worker.mjs"))
		expect(map.workerUrl).toBe(fake.setWorkerUrl.mock.lastCall?.[0])
	})

	it("loads only through a no-SSR dynamic import with a same-aspect placeholder", async () => {
		const placeholder = renderToStaticMarkup(<LazyMap />)
		expect(lazy.options.ssr).toBe(false)
		expect(placeholder).toContain("aspect-[16/10] w-full")
		expect(placeholder).toContain("bg-z1")
		expect(fake.Map.instances).toHaveLength(0)
		expect(await lazy.loader?.()).toEqual(expect.objectContaining({ default: MapView }))
	})
	it("sizes the map itself, enables cooperative gestures, keeps north up and expands one attribution control", () => {
		const { map, html } = mount({ minZoom: 2, maxZoom: 19 })
		expect(html).toContain("aspect-[16/10] w-full")
		expect(map.options).toEqual(
			expect.objectContaining({
				style: navy,
				minZoom: 2,
				maxZoom: 19,
				cooperativeGestures: true,
				attributionControl: { compact: false },
				dragRotate: false,
				touchPitch: false,
				pitchWithRotate: false,
				bearing: 0,
				pitch: 0,
			}),
		)
		expect(map.touchZoomRotate.disableRotation).toHaveBeenCalled()
		expect(map.keyboard.disableRotation).toHaveBeenCalled()
	})

	it("loads the latest props, updates sources and markers in place, and removes absent geometry", () => {
		const { map } = mount({ circle, dot })
		expect(map.addSource).not.toHaveBeenCalled()
		const next = { circle: { ...circle, radius: 90 }, dot: { ...dot, accuracy: 120 } }
		render(next)
		for (const effect of hooks.effects.slice(1)) effect()
		map.fire("load")
		expect(map.addSource).toHaveBeenCalledTimes(2)
		expect(map.sources.place?.setData).toHaveBeenLastCalledWith(
			expect.objectContaining({
				features: [
					expect.objectContaining({ geometry: { type: "Polygon", coordinates: [circleRing(next.circle, 90)] } }),
				],
			}),
		)
		expect(map.sources.accuracy?.setData).toHaveBeenLastCalledWith(
			expect.objectContaining({
				features: [
					expect.objectContaining({ geometry: { type: "Polygon", coordinates: [circleRing(next.dot, 120)] } }),
				],
			}),
		)
		expect(map.addLayer.mock.calls.map(([layer]) => layer.paint)).toEqual([
			{ "fill-color": "#bbdefb", "fill-opacity": 0.2 },
			{ "line-color": "#bbdefb", "line-width": 2.5 },
			{ "fill-color": "#1c7dc8", "fill-opacity": 0.2 },
			{ "line-color": "#1c7dc8", "line-width": 1 },
		])
		const ownDot = fake.Marker.instances[0]
		render({ circle, dot })
		for (const effect of hooks.effects.slice(1)) effect()
		expect(fake.Map.instances).toHaveLength(1)
		expect(fake.Marker.instances).toHaveLength(1)
		expect(map.addSource).toHaveBeenCalledTimes(2)
		render({})
		for (const effect of hooks.effects.slice(1)) effect()
		expect(map.sources.place?.setData).toHaveBeenLastCalledWith({ type: "FeatureCollection", features: [] })
		expect(map.sources.accuracy?.setData).toHaveBeenLastCalledWith({ type: "FeatureCollection", features: [] })
		expect(ownDot?.remove).toHaveBeenCalledOnce()
	})

	it("saves rounded pin moves and clamped handle resizes only on release", () => {
		const edit = { onMove: vi.fn(), onResize: vi.fn(), onCreate: vi.fn(), onPreview: vi.fn() }
		const { map } = mount({ circle, edit })
		map.fire("load")
		const [pin, edge] = fake.Marker.instances
		expect(pin?.options.draggable).toBe(true)
		expect(edge?.options.draggable).toBe(true)
		const edgePosition = edgePoint(circle, circle.radius)
		expect(edge?.setLngLat).toHaveBeenLastCalledWith([edgePosition.lng, edgePosition.lat])
		pin?.setLngLat([13.12345678, 55.12345678])
		pin?.events.dragstart?.()
		pin?.events.drag?.()
		expect(edit.onPreview).toHaveBeenLastCalledWith({ lat: 55.123457, lng: 13.123457, radius: 40 })
		expect(edit.onMove).not.toHaveBeenCalled()
		pin?.events.dragend?.()
		expect(edit.onMove).toHaveBeenCalledExactlyOnceWith({ lat: 55.123457, lng: 13.123457 })
		edge?.setLngLat([circle.lng, circle.lat])
		edge?.events.dragstart?.()
		edge?.events.drag?.()
		expect(edit.onPreview).toHaveBeenLastCalledWith({ ...circle, radius: 5 })
		expect(edit.onResize).not.toHaveBeenCalled()
		expect(edge?.options.element.dataset.radius).toBe("5 m")
		edge?.events.dragend?.()
		expect(edit.onResize).toHaveBeenLastCalledWith(5)
		edge?.setLngLat([circle.lng + 1, circle.lat])
		edge?.events.dragend?.()
		expect(edit.onResize).toHaveBeenLastCalledWith(500)
		map.fire("click", { lngLat: circle })
		expect(edit.onCreate).not.toHaveBeenCalled()
	})

	it("keeps the dragged handle under the pointer while updating the ring and radius label", () => {
		const edit = { onMove: vi.fn(), onResize: vi.fn(), onCreate: vi.fn(), onPreview: vi.fn() }
		const { map } = mount({ circle, edit })
		map.fire("load")
		const edge = fake.Marker.instances[1]
		edge?.events.dragstart?.()
		edge?.setLngLat([13.2, 55.501])
		const calls = edge?.setLngLat.mock.calls.length
		render({ circle: { ...circle, radius: 111 }, edit })
		for (const effect of hooks.effects.slice(1)) effect()
		expect(edge?.setLngLat).toHaveBeenCalledTimes(calls ?? 0)
		expect(edge?.options.element.dataset.radius).toBe("111 m")
		expect(map.sources.place?.setData).toHaveBeenLastCalledWith(
			expect.objectContaining({
				features: [expect.objectContaining({ geometry: { type: "Polygon", coordinates: [circleRing(circle, 111)] } })],
			}),
		)
	})

	it("creates only in an empty editable map and keeps locked maps marker-free", () => {
		const edit = { onMove: vi.fn(), onResize: vi.fn(), onCreate: vi.fn() }
		const { map } = mount({ edit })
		map.fire("load")
		map.fire("click", { lngLat: { lat: 55.12345678, lng: 13.12345678 } })
		expect(edit.onCreate).toHaveBeenCalledExactlyOnceWith({ lat: 55.123457, lng: 13.123457 })
		expect(fake.Marker.instances).toHaveLength(0)
	})

	it("frames bounds or an area without recreating the map and reports manual versus programmatic moves", () => {
		const onMoveEnd = vi.fn()
		const { map } = mount({ circle, dot, framing, onMoveEnd })
		map.fire("moveend")
		expect(onMoveEnd).not.toHaveBeenCalled()
		map.fire("load")
		expect(map.fitBounds).toHaveBeenLastCalledWith(framing.bounds, { padding: 44, maxZoom: 18, duration: 0 })
		render({ framing: { lat: 55, lng: 13, zoom: 12 }, onMoveEnd })
		for (const effect of hooks.effects.slice(1)) effect()
		expect(map.jumpTo).toHaveBeenLastCalledWith({ center: [13, 55], zoom: 12 })
		map.fire("moveend", { originalEvent: {} })
		expect(onMoveEnd).toHaveBeenLastCalledWith({ lat: 55.123457, lng: 13.123457, zoom: 15.68 }, true)
		map.fire("moveend")
		expect(onMoveEnd).toHaveBeenLastCalledWith({ lat: 55.123457, lng: 13.123457, zoom: 15.68 }, false)
		render({ framing: { ...framing, maxZoom: 17 } })
		for (const effect of hooks.effects.slice(1)) effect()
		expect(map.fitBounds).toHaveBeenLastCalledWith(framing.bounds, { padding: 44, maxZoom: 17, duration: 0 })
	})

	it("disables preview interactions and cleans up all markers and the map", () => {
		const edit = { onMove: vi.fn(), onResize: vi.fn(), onCreate: vi.fn() }
		const { map } = mount({ circle, dot, edit, interactive: false })
		map.fire("load")
		expect(map.dragPan.disable).toHaveBeenCalled()
		expect(map.scrollZoom.disable).toHaveBeenCalled()
		for (const marker of fake.Marker.instances) expect(marker.options.draggable).toBe(false)
		fake.Marker.instances[0]?.events.dragend?.()
		fake.Marker.instances[1]?.events.dragend?.()
		map.fire("click", { lngLat: circle })
		expect(edit.onMove).not.toHaveBeenCalled()
		expect(edit.onResize).not.toHaveBeenCalled()
		expect(edit.onCreate).not.toHaveBeenCalled()
		for (const stop of cleanup) stop()
		cleanup = []
		for (const marker of fake.Marker.instances) expect(marker.remove).toHaveBeenCalledOnce()
		expect(map.remove).toHaveBeenCalledOnce()
	})
})
