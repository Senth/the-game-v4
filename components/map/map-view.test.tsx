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
		addTo = vi.fn(() => {
			this.options.element.style.opacity = "1"
			return this
		})
		setDraggable = vi.fn(() => this)
		remove = vi.fn()
		constructor(public options: { element: HTMLElement; draggable: boolean }) {
			options.element.className = `${options.element.className} maplibregl-marker`.trim()
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

type FakeElement = {
	className: string
	style: Record<string, string>
	dataset: Record<string, string>
	textContent: string
	children: FakeElement[]
	parent?: FakeElement
	listeners: Record<string, () => void>
	classList: { toggle: (name: string, force: boolean) => boolean }
	firstElementChild: FakeElement | undefined
	setAttribute: (name: string, value: string) => void
	getAttribute: (name: string) => string | null
	closest: (selector: string) => FakeElement | null
	append: (...children: FakeElement[]) => void
	addEventListener: (name: string, callback: () => void) => void
	click: () => void
}

const circle = { number: 1, lat: 55.5, lng: 13.2, radius: 40 }
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
		createElement: () => {
			const attributes: Record<string, string> = {}
			const element: FakeElement = {
				className: "",
				style: {},
				classList: {
					toggle: (name: string, force: boolean): boolean => {
						const classes = new Set(element.className.split(" ").filter(Boolean))
						if (force) classes.add(name)
						else classes.delete(name)
						element.className = [...classes].join(" ")
						return force
					},
				},
				dataset: {},
				textContent: "",
				children: [],
				listeners: {},
				get firstElementChild(): FakeElement | undefined {
					return element.children[0]
				},
				setAttribute: (name, value) => {
					attributes[name] = value
				},
				getAttribute: (name) => attributes[name] ?? null,
				closest: (selector: string) => (element.className.split(" ").includes(selector.slice(1)) ? element : null),
				append: (...children) => {
					for (const child of children) {
						child.parent = element
						element.children.push(child)
					}
				},
				addEventListener: (name, callback) => {
					element.listeners[name] = callback
				},
				click: () => {
					let current: FakeElement | undefined = element
					while (current) {
						current.listeners.click?.()
						current = current.parent
					}
				},
			}
			return element
		},
	})
	vi.stubGlobal("getComputedStyle", () => ({
		getPropertyValue: (key: string) =>
			key === "--color-head" ? "#bbdefb" : key === "--color-pace-ok" ? "#4ade80" : "#1c7dc8",
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
	it("fills its parent only when requested", () => {
		const placeholder = renderToStaticMarkup(<LazyMap fill />)
		expect(placeholder).toContain("h-full min-h-0 w-full")
		const { html } = mount({ fill: true })
		expect(html).toContain("h-full min-h-0 w-full overflow-hidden bg-z1")
		expect(html).not.toContain("aspect-[16/10]")
	})

	it("loads the latest props, updates sources and markers in place, and removes absent geometry", () => {
		const { map } = mount({ circles: [circle], dot })
		expect(map.addSource).not.toHaveBeenCalled()
		const next = { circles: [{ ...circle, radius: 90 }], dot: { ...dot, accuracy: 120 } }
		const nextCircle = next.circles[0]
		if (!nextCircle) throw new Error("Next circle missing")
		render(next)
		for (const effect of hooks.effects.slice(1)) effect()
		map.fire("load")
		expect(map.addSource).toHaveBeenCalledTimes(3)
		expect(map.sources.place?.setData).toHaveBeenLastCalledWith(
			expect.objectContaining({
				features: [
					expect.objectContaining({
						properties: { number: 1, held: false },
						geometry: { type: "Polygon", coordinates: [circleRing(nextCircle, 90)] },
					}),
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
			{ "fill-color": ["case", ["get", "held"], "#4ade80", "#bbdefb"], "fill-opacity": 0.2 },
			{ "line-color": ["case", ["get", "held"], "#4ade80", "#bbdefb"], "line-width": 2.5 },
			{ "fill-color": "#1c7dc8", "fill-opacity": 0.2 },
			{ "line-color": "#1c7dc8", "line-width": 1 },
			{ "fill-color": ["get", "color"], "fill-opacity": 0.2 },
			{ "line-color": ["get", "color"], "line-width": 1 },
		])
		const ownDot = fake.Marker.instances.find((marker) => marker.options.element.className.includes("map-own-dot"))
		render({ circles: [circle], dot })
		for (const effect of hooks.effects.slice(1)) effect()
		expect(fake.Map.instances).toHaveLength(1)
		expect(fake.Marker.instances).toHaveLength(2)
		expect(map.addSource).toHaveBeenCalledTimes(3)
		render({})
		for (const effect of hooks.effects.slice(1)) effect()
		expect(map.sources.place?.setData).toHaveBeenLastCalledWith({ type: "FeatureCollection", features: [] })
		expect(map.sources.accuracy?.setData).toHaveBeenLastCalledWith({ type: "FeatureCollection", features: [] })
		expect(ownDot?.remove).toHaveBeenCalledOnce()
	})

	it("renders selectable phone markers and colored accuracy rings, updating and removing by id", () => {
		const first = {
			id: "phone-1",
			lat: 55.52,
			lng: 13.21,
			accuracy: 42,
			color: "hsl(120 75% 72%)",
			team: "Ninjas",
			name: "Keen Otter",
		}
		const onPhoneSelect = vi.fn()
		const { map } = mount({ phones: [first], onPhoneSelect })
		map.fire("load")
		const marker = fake.Marker.instances[0]
		const element = marker?.getElement() as unknown as FakeElement
		const [dot, label] = element.children
		expect(map.sources.phones?.setData).toHaveBeenLastCalledWith(
			expect.objectContaining({
				features: [
					expect.objectContaining({
						properties: { color: first.color },
						geometry: { type: "Polygon", coordinates: [circleRing(first, first.accuracy)] },
					}),
				],
			}),
		)
		expect(map.addLayer.mock.calls.map(([layer]) => layer)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "phones-fill", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.2 } }),
				expect.objectContaining({ id: "phones-line", paint: { "line-color": ["get", "color"], "line-width": 1 } }),
			]),
		)
		expect(element.getAttribute("aria-label")).toBe("Ninjas · Keen Otter")
		expect(dot?.style.backgroundColor).toBe(first.color)
		expect(label?.children.map((child) => child.textContent)).toEqual(["Ninjas", " · Keen Otter"])
		expect(label?.children[0]?.style.color).toBe(first.color)
		dot?.click()
		label?.click()
		expect(onPhoneSelect).toHaveBeenNthCalledWith(1, first.id)
		expect(onPhoneSelect).toHaveBeenNthCalledWith(2, first.id)

		const next = { ...first, lat: 55.53, lng: 13.22, accuracy: 80 }
		render({ phones: [next], onPhoneSelect })
		for (const effect of hooks.effects.slice(1)) effect()
		expect(fake.Map.instances).toHaveLength(1)
		expect(fake.Marker.instances).toHaveLength(1)
		expect(marker?.setLngLat).toHaveBeenLastCalledWith([next.lng, next.lat])
		expect(map.sources.phones?.setData).toHaveBeenLastCalledWith(
			expect.objectContaining({
				features: [
					expect.objectContaining({ geometry: { type: "Polygon", coordinates: [circleRing(next, next.accuracy)] } }),
				],
			}),
		)
		render({ phones: [] })
		for (const effect of hooks.effects.slice(1)) effect()
		expect(marker?.remove).toHaveBeenCalledOnce()
	})

	it("renders held and empty numbered badges and updates teammate labels, fading and expiry", () => {
		const circles = [circle, { ...circle, number: 2, lat: 55.51, held: true }]
		const phone = { name: "Keen <Otter>", lat: 55.52, lng: 13.21, ageMs: 19_999 }
		const { map } = mount({ circles, teammates: [phone] })
		map.fire("load")
		const [empty, held, teammate] = fake.Marker.instances
		expect(empty?.options.element.getAttribute("aria-label")).toBe("Place 1 · Empty")
		expect(held?.options.element.getAttribute("aria-label")).toBe("Place 2 · Held")
		expect(held?.options.element.dataset.held).toBe("true")
		expect(empty?.setLngLat).toHaveBeenLastCalledWith(circleRing(circle, circle.radius, 4)[0])
		expect([empty, held].map((marker) => marker?.options.element.children[0]?.textContent)).toEqual(["1", "2"])
		const visible = teammate?.options.element.firstElementChild
		expect(visible?.className).toContain("map-teammate-dot")
		for (const marker of [empty, held, teammate])
			expect(marker?.options.element.className).toContain("maplibregl-marker")
		expect(visible?.firstElementChild?.textContent).toBe("Keen <Otter>")
		expect(teammate?.options.draggable).toBe(false)
		for (const ageMs of [20_000, 29_999]) {
			render({ circles, teammates: [{ ...phone, ageMs }] })
			for (const effect of hooks.effects.slice(1)) effect()
			expect(visible?.className).toContain("opacity-50")
			expect(teammate?.options.element.className).toContain("maplibregl-marker")
			expect(visible?.firstElementChild?.className).toContain("motion-safe:animate-pulse")
			expect(visible?.firstElementChild?.textContent).toBe(`Keen <Otter> · ${Math.floor(ageMs / 1000)} s`)
		}
		render({ circles, teammates: [{ ...phone, ageMs: 30_000 }] })
		for (const effect of hooks.effects.slice(1)) effect()
		expect(teammate?.remove).toHaveBeenCalledOnce()
		expect(map.fitBounds).not.toHaveBeenCalled()
	})

	it("fades teammate dot and name inside the marker root despite MapLibre inline opacity", () => {
		const phone = { name: "Keen Otter", lat: 55.52, lng: 13.21, ageMs: 19_999 }
		const { map } = mount({ teammates: [phone] })
		map.fire("load")
		const root = fake.Marker.instances[0]?.getElement()
		if (!root) throw new Error("Teammate marker missing")
		expect(root.style.opacity).toBe("1")
		for (const ageMs of [20_000, 28_000, 29_999, 0]) {
			render({ teammates: [{ ...phone, ageMs }] })
			for (const effect of hooks.effects.slice(1)) effect()
			expect(root.className).not.toContain("opacity-50")
			const dot = root.firstElementChild
			expect(dot?.className).toContain("map-teammate-dot")
			expect(dot?.className.includes("opacity-50")).toBe(ageMs >= 20_000)
			expect(dot?.firstElementChild?.className.includes("motion-safe:animate-pulse")).toBe(ageMs >= 20_000)
			expect(dot?.firstElementChild?.textContent).toBe(
				`Keen Otter${ageMs >= 20_000 ? ` · ${Math.floor(ageMs / 1000)} s` : ""}`,
			)
			expect(root.style.opacity).toBe("1")
		}
	})

	it("saves rounded pin moves and clamped handle resizes only on release", () => {
		const edit = { onMove: vi.fn(), onResize: vi.fn(), onCreate: vi.fn(), onPreview: vi.fn() }
		const { map } = mount({ circles: [circle], edit })
		map.fire("load")
		const [pin, edge] = fake.Marker.instances
		expect(pin?.options.draggable).toBe(true)
		expect(edge?.options.draggable).toBe(true)
		const edgePosition = edgePoint(circle, circle.radius)
		expect(edge?.setLngLat).toHaveBeenLastCalledWith([edgePosition.lng, edgePosition.lat])
		pin?.setLngLat([13.12345678, 55.12345678])
		pin?.events.dragstart?.()
		pin?.events.drag?.()
		expect(edit.onPreview).toHaveBeenLastCalledWith(1, { lat: 55.123457, lng: 13.123457, radius: 40, number: 1 })
		expect(edit.onMove).not.toHaveBeenCalled()
		pin?.events.dragend?.()
		expect(edit.onMove).toHaveBeenCalledExactlyOnceWith(1, { lat: 55.123457, lng: 13.123457 })
		edge?.setLngLat([circle.lng, circle.lat])
		edge?.events.dragstart?.()
		edge?.events.drag?.()
		expect(edit.onPreview).toHaveBeenLastCalledWith(1, { ...circle, radius: 5 })
		expect(edit.onResize).not.toHaveBeenCalled()
		expect(edge?.options.element.dataset.radius).toBe("5 m")
		edge?.events.dragend?.()
		expect(edit.onResize).toHaveBeenLastCalledWith(1, 5)
		edge?.setLngLat([circle.lng + 1, circle.lat])
		edge?.events.dragend?.()
		expect(edit.onResize).toHaveBeenLastCalledWith(1, 500)
		map.fire("click", { lngLat: circle })
		expect(edit.onCreate).toHaveBeenCalledExactlyOnceWith({ lat: circle.lat, lng: circle.lng })
	})

	it("keeps the dragged handle under the pointer while updating the ring and radius label", () => {
		const edit = { onMove: vi.fn(), onResize: vi.fn(), onCreate: vi.fn(), onPreview: vi.fn() }
		const { map } = mount({ circles: [circle], edit })
		map.fire("load")
		const edge = fake.Marker.instances[1]
		edge?.events.dragstart?.()
		edge?.setLngLat([13.2, 55.501])
		const calls = edge?.setLngLat.mock.calls.length
		render({ circles: [{ ...circle, radius: 111 }], edit })
		for (const effect of hooks.effects.slice(1)) effect()
		expect(edge?.setLngLat).toHaveBeenCalledTimes(calls ?? 0)
		expect(edge?.options.element.dataset.radius).toBe("111 m")
		expect(map.sources.place?.setData).toHaveBeenLastCalledWith(
			expect.objectContaining({
				features: [expect.objectContaining({ geometry: { type: "Polygon", coordinates: [circleRing(circle, 111)] } })],
			}),
		)
	})

	it("shows numbered circles with independent pin and edge handles for every place", () => {
		const circles = [circle, { ...circle, number: 2, lat: 55.51 }, { ...circle, number: 3, lat: 55.52 }]
		const edit = { onMove: vi.fn(), onResize: vi.fn(), onCreate: vi.fn(), onPreview: vi.fn() }
		const { map } = mount({ circles, edit })
		map.fire("load")
		const source = map.sources.place?.setData.mock.lastCall?.[0]
		if (!source) throw new Error("Place source missing")
		const features = (source as { features: { properties: { number: number } }[] }).features
		expect(features.map(({ properties }) => properties.number)).toEqual([1, 2, 3])
		const pins = fake.Marker.instances.filter(({ options }) =>
			options.element.getAttribute?.("aria-label")?.startsWith("Move place"),
		)
		const edges = fake.Marker.instances.filter(({ options }) =>
			options.element.getAttribute?.("aria-label")?.startsWith("Resize place"),
		)
		expect(pins).toHaveLength(3)
		expect(edges).toHaveLength(3)
		expect(pins.map(({ options }) => options.element.children[0]?.textContent)).toEqual(["1", "2", "3"])
		pins[2]?.setLngLat([13.21, 55.52])
		pins[2]?.events.dragend?.()
		expect(edit.onMove).toHaveBeenCalledExactlyOnceWith(3, { lat: 55.52, lng: 13.21 })
		edges[1]?.setLngLat([13.21, 55.51])
		edges[1]?.events.dragend?.()
		expect(edit.onResize).toHaveBeenCalledExactlyOnceWith(2, expect.any(Number))
	})

	it("creates only on editable maps and keeps empty maps marker-free", () => {
		const edit = { onMove: vi.fn(), onResize: vi.fn(), onCreate: vi.fn() }
		const { map } = mount({ edit })
		map.fire("load")
		map.fire("click", { lngLat: { lat: 55.12345678, lng: 13.12345678 } })
		expect(edit.onCreate).toHaveBeenCalledExactlyOnceWith({ lat: 55.123457, lng: 13.123457 })
		expect(fake.Marker.instances).toHaveLength(0)
	})

	it("creates places from background clicks, not pin or edge-handle clicks", () => {
		const edit = { onMove: vi.fn(), onResize: vi.fn(), onCreate: vi.fn() }
		const { map } = mount({ circles: [circle], edit })
		map.fire("load")
		const [pin, edge] = fake.Marker.instances
		const point = { lat: 55.6, lng: 13.3 }

		map.fire("click", { lngLat: point, originalEvent: { target: pin?.options.element } })
		expect(edit.onCreate).not.toHaveBeenCalled()

		map.fire("click", { lngLat: point, originalEvent: { target: edge?.options.element } })
		expect(edit.onCreate).not.toHaveBeenCalled()

		map.fire("click", { lngLat: point, originalEvent: { target: { closest: () => null } } })
		expect(edit.onCreate).toHaveBeenCalledExactlyOnceWith(point)
	})

	it("keeps numbered pins visible but disables their handles and map taps when locked", () => {
		const edit = { enabled: false, onMove: vi.fn(), onResize: vi.fn(), onCreate: vi.fn() }
		const { map } = mount({ circles: [circle], edit })
		map.fire("load")
		expect(fake.Marker.instances).toHaveLength(2)
		for (const marker of fake.Marker.instances) expect(marker.options.draggable).toBe(false)
		map.fire("click", { lngLat: circle })
		fake.Marker.instances[0]?.events.dragend?.()
		fake.Marker.instances[1]?.events.dragend?.()
		expect(edit.onCreate).not.toHaveBeenCalled()
		expect(edit.onMove).not.toHaveBeenCalled()
		expect(edit.onResize).not.toHaveBeenCalled()
	})

	it("frames bounds or an area without recreating the map and reports manual versus programmatic moves", () => {
		const onMoveEnd = vi.fn()
		const { map } = mount({ circles: [circle], dot, framing, onMoveEnd })
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
		const { map } = mount({ circles: [circle], dot, edit, interactive: false })
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
