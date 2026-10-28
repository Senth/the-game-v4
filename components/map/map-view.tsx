"use client"

import {
	type GeoJSONSource,
	type GeoJSONSourceSpecification,
	Map as LibreMap,
	Marker,
	type StyleSpecification,
	setWorkerUrl,
} from "maplibre-gl"
import { useEffect, useEffectEvent, useRef } from "react"
import { circleRing, edgePoint, radiusFromHandle, roundCoordinate } from "@/lib/domain/map"
import type { Place } from "@/lib/domain/schemas"
import navy from "@/public/map/navy.json"
import "maplibre-gl/dist/maplibre-gl.css"
import "./map.css"

type Coordinates = Pick<Place, "lat" | "lng">
type Circle = Coordinates & { number: number; radius: number }
type Area = Coordinates & { zoom: number }
type Framing = Area | { bounds: [[number, number], [number, number]]; maxZoom?: number }

export type MapViewProps = {
	aspectRatio?: "16/10" | "4/3"
	circles?: Circle[]
	dot?: (Coordinates & { accuracy: number }) | null
	maxZoom?: number
	minZoom?: number
	edit?: {
		enabled?: boolean
		onMove: (number: number, point: Coordinates) => void
		onResize: (number: number, radius: number) => void
		onCreate: (point: Coordinates) => void
		onPreview?: (number: number, circle: Circle) => void
	} | null
	framing?: Framing | null
	interactive?: boolean
	onMoveEnd?: (area: Area, manual: boolean) => void
}

function polygon(center: Coordinates | null | undefined, radius: number): GeoJSONSourceSpecification["data"] {
	return {
		type: "FeatureCollection",
		features: center
			? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circleRing(center, radius)] } }]
			: [],
	}
}

function placePolygons(circles: Circle[]): GeoJSONSourceSpecification["data"] {
	return {
		type: "FeatureCollection",
		features: circles.map(({ number, ...circle }) => ({
			type: "Feature",
			properties: { number },
			geometry: { type: "Polygon", coordinates: [circleRing(circle, circle.radius)] },
		})),
	}
}

export default function MapView({
	aspectRatio = "16/10",
	circles = [],
	dot,
	edit,
	framing,
	interactive = true,
	maxZoom,
	minZoom,
	onMoveEnd,
}: MapViewProps) {
	const container = useRef<HTMLDivElement>(null)
	const instance = useRef<LibreMap | null>(null)
	const markers = useRef<{ places: Record<number, { pin?: Marker; edge?: Marker }>; dot?: Marker }>({ places: {} })
	const ready = useRef(false)
	const dragging = useRef<{ number: number; key: "pin" | "edge" } | null>(null)

	const preview = useEffectEvent((number: number, key: "pin" | "edge") => {
		const marker = markers.current.places[number]?.[key]
		const point = marker?.getLngLat()
		const circle = circles.find((item) => item.number === number)
		if (!marker || !point || !circle || !interactive || !edit || edit.enabled === false) return
		const next =
			key === "pin"
				? { lat: roundCoordinate(point.lat), lng: roundCoordinate(point.lng), radius: circle.radius }
				: { ...circle, radius: radiusFromHandle(circle, point) }
		if (key === "edge") marker.getElement().dataset.radius = `${next.radius} m`
		edit.onPreview?.(number, { ...next, number })
	})

	const movePin = useEffectEvent((number: number) => {
		const point = markers.current.places[number]?.pin?.getLngLat()
		if (point && interactive && edit?.enabled !== false)
			edit?.onMove(number, { lat: roundCoordinate(point.lat), lng: roundCoordinate(point.lng) })
	})
	const resize = useEffectEvent((number: number) => {
		const point = markers.current.places[number]?.edge?.getLngLat()
		const circle = circles.find((item) => item.number === number)
		if (point && circle && interactive && edit?.enabled !== false)
			edit?.onResize(number, radiusFromHandle(circle, point))
	})
	const create = useEffectEvent((point: Coordinates) => {
		if (interactive && edit && edit.enabled !== false)
			edit.onCreate({ lat: roundCoordinate(point.lat), lng: roundCoordinate(point.lng) })
	})
	const moved = useEffectEvent((manual: boolean) => {
		const map = instance.current
		if (!map || !ready.current) return
		const center = map.getCenter()
		onMoveEnd?.(
			{ lat: roundCoordinate(center.lat), lng: roundCoordinate(center.lng), zoom: Number(map.getZoom().toFixed(2)) },
			manual,
		)
	})
	const updateSources = useEffectEvent(
		(nextCircles = circles, nextDot = dot, controls = edit, enabled = interactive) => {
			const map = instance.current
			if (!map || !ready.current) return
			const place = map.getSource("place") as GeoJSONSource
			const accuracy = map.getSource("accuracy") as GeoJSONSource
			place.setData(placePolygons(nextCircles))
			accuracy.setData(polygon(nextDot, nextDot?.accuracy ?? 0))
			const numbers = new Set(nextCircles.map(({ number }) => number))
			for (const [number, pair] of Object.entries(markers.current.places)) {
				if (controls && numbers.has(Number(number))) continue
				pair.pin?.remove()
				pair.edge?.remove()
				delete markers.current.places[Number(number)]
			}
			for (const circle of nextCircles) {
				let pair = markers.current.places[circle.number]
				if (!pair) {
					pair = {}
					markers.current.places[circle.number] = pair
				}
				for (const key of ["pin", "edge"] as const) {
					if (!controls) {
						pair[key]?.remove()
						delete pair[key]
						continue
					}
					const position = key === "pin" ? circle : edgePoint(circle, circle.radius)
					let marker = pair[key]
					if (!marker) {
						const element = document.createElement("div")
						element.className = "map-drag-target"
						element.setAttribute(
							"aria-label",
							key === "pin" ? `Move place ${circle.number}` : `Resize place ${circle.number} radius`,
						)
						const visible = document.createElement("span")
						visible.className = key === "pin" ? "map-pin" : "map-edge"
						if (key === "pin") visible.textContent = String(circle.number)
						element.append(visible)
						marker = new Marker({ element, draggable: enabled && controls.enabled !== false })
							.setLngLat([position.lng, position.lat])
							.addTo(map)
						marker.on("dragstart", () => {
							dragging.current = { number: circle.number, key }
						})
						marker.on("drag", () => preview(circle.number, key))
						marker.on("dragend", () => {
							dragging.current = null
							if (key === "pin") movePin(circle.number)
							else resize(circle.number)
						})
						pair[key] = marker
					}
					marker.setDraggable(enabled && controls.enabled !== false)
					if (dragging.current?.number !== circle.number || dragging.current.key !== key)
						marker.setLngLat([position.lng, position.lat])
					if (key === "edge") marker.getElement().dataset.radius = `${circle.radius} m`
				}
			}
			if (!nextDot) {
				markers.current.dot?.remove()
				delete markers.current.dot
			} else {
				let marker = markers.current.dot
				if (!marker) {
					const element = document.createElement("div")
					element.className = "map-own-dot"
					element.setAttribute("aria-label", "Your position")
					marker = new Marker({ element, draggable: false }).setLngLat([nextDot.lng, nextDot.lat]).addTo(map)
					markers.current.dot = marker
				}
				marker.setLngLat([nextDot.lng, nextDot.lat])
			}
		},
	)
	const frame = useEffectEvent((view = framing) => {
		const map = instance.current
		if (!map || !ready.current || !view) return
		if ("bounds" in view) map.fitBounds(view.bounds, { padding: 44, maxZoom: view.maxZoom ?? 18, duration: 0 })
		else map.jumpTo({ center: [view.lng, view.lat], zoom: view.zoom })
	})
	const setInteraction = useEffectEvent((enabled = interactive) => {
		const map = instance.current
		if (!map) return
		for (const handler of [
			map.dragPan,
			map.scrollZoom,
			map.boxZoom,
			map.doubleClickZoom,
			map.touchZoomRotate,
			map.keyboard,
		]) {
			if (enabled) handler.enable()
			else handler.disable()
		}
		map.touchZoomRotate.disableRotation()
		map.keyboard.disableRotation()
	})

	useEffect(() => {
		if (!container.current) return
		setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href)
		const map = new LibreMap({
			container: container.current,
			style: navy as StyleSpecification,
			...(minZoom === undefined ? {} : { minZoom }),
			...(maxZoom === undefined ? {} : { maxZoom }),
			cooperativeGestures: true,
			attributionControl: { compact: false },
			dragRotate: false,
			touchPitch: false,
			pitchWithRotate: false,
			bearing: 0,
			pitch: 0,
		})
		instance.current = map
		setInteraction()
		map.on("click", (event) => create(event.lngLat))
		map.on("moveend", (event) => moved(!!event.originalEvent))
		map.on("load", () => {
			for (const [id, token] of [
				["place", "head"],
				["accuracy", "accent"],
			] as const) {
				map.addSource(id, { type: "geojson", data: polygon(null, 0) })
				const color = getComputedStyle(container.current as HTMLDivElement)
					.getPropertyValue(`--color-${token}`)
					.trim()
				map.addLayer({
					id: `${id}-fill`,
					type: "fill",
					source: id,
					paint: { "fill-color": color, "fill-opacity": 0.2 },
				})
				map.addLayer({
					id: `${id}-line`,
					type: "line",
					source: id,
					paint: { "line-color": color, "line-width": id === "place" ? 2.5 : 1 },
				})
			}
			ready.current = true
			updateSources()
			frame()
		})
		return () => {
			ready.current = false
			for (const pair of Object.values(markers.current.places)) {
				pair.pin?.remove()
				pair.edge?.remove()
			}
			markers.current.dot?.remove()
			markers.current = { places: {} }
			map.remove()
			instance.current = null
		}
	}, [maxZoom, minZoom])

	useEffect(() => {
		updateSources(circles, dot, edit, interactive)
	}, [circles, dot, edit, interactive])
	useEffect(() => {
		frame(framing)
	}, [framing])
	useEffect(() => {
		setInteraction(interactive)
	}, [interactive])

	return (
		<div
			ref={container}
			className={`game-map ${aspectRatio === "4/3" ? "aspect-[4/3]" : "aspect-[16/10]"} w-full overflow-hidden rounded-md bg-z1`}
		/>
	)
}
