"use client"

import {
	type GeoJSONSource,
	type GeoJSONSourceSpecification,
	Map as LibreMap,
	Marker,
	type StyleSpecification,
} from "maplibre-gl"
import { useEffect, useEffectEvent, useRef } from "react"
import { circleRing, edgePoint, radiusFromHandle, roundCoordinate } from "@/lib/domain/map"
import type { Place } from "@/lib/domain/schemas"
import navy from "@/public/map/navy.json"
import "maplibre-gl/dist/maplibre-gl.css"
import "./map.css"

type Coordinates = Pick<Place, "lat" | "lng">
type Circle = Coordinates & { radius: number }
type Area = Coordinates & { zoom: number }
type Framing = Area | { bounds: [[number, number], [number, number]]; maxZoom?: number }

export type MapViewProps = {
	circle?: Circle | null
	dot?: (Coordinates & { accuracy: number }) | null
	edit?: {
		onMove: (point: Coordinates) => void
		onResize: (radius: number) => void
		onCreate: (point: Coordinates) => void
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

export default function MapView({ circle, dot, edit, framing, interactive = true, onMoveEnd }: MapViewProps) {
	const container = useRef<HTMLDivElement>(null)
	const instance = useRef<LibreMap | null>(null)
	const markers = useRef<{ pin?: Marker; edge?: Marker; dot?: Marker }>({})
	const ready = useRef(false)

	const movePin = useEffectEvent(() => {
		const point = markers.current.pin?.getLngLat()
		if (point && interactive) edit?.onMove({ lat: roundCoordinate(point.lat), lng: roundCoordinate(point.lng) })
	})
	const resize = useEffectEvent(() => {
		const point = markers.current.edge?.getLngLat()
		if (point && circle && interactive) edit?.onResize(radiusFromHandle(circle, point))
	})
	const create = useEffectEvent((point: Coordinates) => {
		if (!circle && interactive) edit?.onCreate({ lat: roundCoordinate(point.lat), lng: roundCoordinate(point.lng) })
	})
	const moved = useEffectEvent((manual: boolean) => {
		const map = instance.current
		if (!map) return
		const center = map.getCenter()
		onMoveEnd?.(
			{ lat: roundCoordinate(center.lat), lng: roundCoordinate(center.lng), zoom: Number(map.getZoom().toFixed(2)) },
			manual,
		)
	})
	const updateSources = useEffectEvent((nextCircle = circle, nextDot = dot, controls = edit, enabled = interactive) => {
		const map = instance.current
		if (!map || !ready.current) return
		const place = map.getSource("place") as GeoJSONSource
		const accuracy = map.getSource("accuracy") as GeoJSONSource
		place.setData(polygon(nextCircle, nextCircle?.radius ?? 0))
		accuracy.setData(polygon(nextDot, nextDot?.accuracy ?? 0))
		const positions = { pin: nextCircle, edge: nextCircle && edgePoint(nextCircle, nextCircle.radius), dot: nextDot }
		for (const key of ["pin", "edge", "dot"] as const) {
			const position = positions[key]
			if (!position || (key !== "dot" && !controls)) {
				markers.current[key]?.remove()
				delete markers.current[key]
				continue
			}
			let marker = markers.current[key]
			if (!marker) {
				const element = document.createElement("div")
				element.className = key === "dot" ? "map-own-dot" : "map-drag-target"
				element.setAttribute(
					"aria-label",
					key === "pin" ? "Move place" : key === "edge" ? "Resize radius" : "Your position",
				)
				if (key !== "dot") {
					const visible = document.createElement("span")
					visible.className = key === "pin" ? "map-pin" : "map-edge"
					element.append(visible)
				}
				marker = new Marker({ element, draggable: key !== "dot" && enabled })
					.setLngLat([position.lng, position.lat])
					.addTo(map)
				if (key !== "dot") marker.on("dragend", key === "pin" ? movePin : resize)
				markers.current[key] = marker
			}
			marker.setDraggable(key !== "dot" && enabled).setLngLat([position.lng, position.lat])
		}
	})
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
		const map = new LibreMap({
			container: container.current,
			style: navy as StyleSpecification,
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
			for (const marker of Object.values(markers.current)) marker.remove()
			markers.current = {}
			map.remove()
			instance.current = null
		}
	}, [])

	useEffect(() => {
		updateSources(circle, dot, edit, interactive)
	}, [circle, dot, edit, interactive])
	useEffect(() => {
		frame(framing)
	}, [framing])
	useEffect(() => {
		setInteraction(interactive)
	}, [interactive])

	return <div ref={container} className="game-map aspect-[16/10] w-full overflow-hidden rounded-md bg-z1" />
}
