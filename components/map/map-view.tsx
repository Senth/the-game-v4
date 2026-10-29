"use client"

import {
	type ExpressionSpecification,
	type GeoJSONSource,
	type GeoJSONSourceSpecification,
	Map as LibreMap,
	Marker,
	type StyleSpecification,
	setWorkerUrl,
} from "maplibre-gl"
import { useEffect, useEffectEvent, useRef } from "react"
import { fadeStartMs, fixTtlMs } from "@/lib/domain/location"
import { circleRing, edgePoint, radiusFromHandle, roundCoordinate } from "@/lib/domain/map"
import type { Place } from "@/lib/domain/schemas"
import navy from "@/public/map/navy.json"
import "maplibre-gl/dist/maplibre-gl.css"
import "./map.css"

type Coordinates = Pick<Place, "lat" | "lng">
type Circle = Coordinates & { number: number; radius: number; held?: boolean }
type Teammate = Coordinates & { name: string; ageMs: number }
type LivePhone = Coordinates & { id: string; accuracy: number; color: string; team: string; name: string }
type Area = Coordinates & { zoom: number }
type Framing = Area | { bounds: [[number, number], [number, number]]; maxZoom?: number }

export type MapViewProps = {
	aspectRatio?: "16/10" | "4/3"
	circles?: Circle[]
	dot?: (Coordinates & { accuracy: number }) | null
	teammates?: Teammate[]
	phones?: LivePhone[]
	onPhoneSelect?: (id: string) => void
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
		features: circles.map(({ number, held, ...circle }) => ({
			type: "Feature",
			properties: { number, held: !!held },
			geometry: { type: "Polygon", coordinates: [circleRing(circle, circle.radius)] },
		})),
	}
}

function phonePolygons(phones: LivePhone[]): GeoJSONSourceSpecification["data"] {
	return {
		type: "FeatureCollection",
		features: phones.map(({ lat, lng, accuracy, color }) => ({
			type: "Feature",
			properties: { color },
			geometry: { type: "Polygon", coordinates: [circleRing({ lat, lng }, accuracy)] },
		})),
	}
}

export default function MapView({
	aspectRatio = "16/10",
	circles = [],
	dot,
	teammates = [],
	phones = [],
	onPhoneSelect,
	edit,
	framing,
	interactive = true,
	maxZoom,
	minZoom,
	onMoveEnd,
}: MapViewProps) {
	const container = useRef<HTMLDivElement>(null)
	const instance = useRef<LibreMap | null>(null)
	const markers = useRef<{
		places: Record<number, { pin?: Marker; edge?: Marker }>
		teammates: Map<string, Marker>
		phones: Map<string, Marker>
		dot?: Marker
	}>({ places: {}, teammates: new Map(), phones: new Map() })
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
	const selectPhone = useEffectEvent((id: string) => onPhoneSelect?.(id))
	const updateSources = useEffectEvent(
		(
			nextCircles = circles,
			nextDot = dot,
			controls = edit,
			enabled = interactive,
			nextTeammates = teammates,
			nextPhones = phones,
		) => {
			const map = instance.current
			if (!map || !ready.current) return
			const place = map.getSource("place") as GeoJSONSource
			const accuracy = map.getSource("accuracy") as GeoJSONSource
			const phoneAccuracy = map.getSource("phones") as GeoJSONSource
			place.setData(placePolygons(nextCircles))
			accuracy.setData(polygon(nextDot, nextDot?.accuracy ?? 0))
			phoneAccuracy.setData(phonePolygons(nextPhones))
			const numbers = new Set(nextCircles.map(({ number }) => number))
			for (const [number, pair] of Object.entries(markers.current.places)) {
				if (numbers.has(Number(number))) continue
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
					if (!controls && key === "edge") {
						pair[key]?.remove()
						delete pair[key]
						continue
					}
					let position: Coordinates = key === "pin" ? circle : edgePoint(circle, circle.radius)
					if (!controls) {
						const [lng, lat] = circleRing(circle, circle.radius, 4)[0] ?? [circle.lng, circle.lat]
						position = { lng, lat }
					}
					let marker = pair[key]
					if (!marker) {
						const element = document.createElement("div")
						const visible = document.createElement("span")
						visible.className = key === "pin" ? "map-pin" : "map-edge"
						if (key === "pin") visible.textContent = String(circle.number)
						element.append(visible)
						marker = new Marker({ element, draggable: enabled && !!controls && controls.enabled !== false })
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
					const element = marker.getElement()
					element.classList.toggle("map-drag-target", !!controls)
					element.classList.toggle("map-place-badge", !controls)
					element.dataset.held = String(!!circle.held)
					element.setAttribute(
						"aria-label",
						controls
							? key === "pin"
								? `Move place ${circle.number}`
								: `Resize place ${circle.number} radius`
							: `Place ${circle.number} · ${circle.held ? "Held" : "Empty"}`,
					)
					marker.setDraggable(enabled && !!controls && controls.enabled !== false)
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
			const fresh = nextTeammates.filter((phone) => phone.ageMs < fixTtlMs)
			const names = new Set(fresh.map((phone) => phone.name))
			for (const [name, marker] of markers.current.teammates) {
				if (names.has(name)) continue
				marker.remove()
				markers.current.teammates.delete(name)
			}
			for (const phone of fresh) {
				let marker = markers.current.teammates.get(phone.name)
				if (!marker) {
					const element = document.createElement("div")
					const visible = document.createElement("div")
					visible.className = "map-teammate-dot"
					visible.append(document.createElement("span"))
					element.append(visible)
					marker = new Marker({ element, draggable: false }).setLngLat([phone.lng, phone.lat]).addTo(map)
					markers.current.teammates.set(phone.name, marker)
				}
				const fading = phone.ageMs >= fadeStartMs
				const visible = marker.getElement().firstElementChild as HTMLElement
				visible.classList.toggle("opacity-50", fading)
				const label = visible.firstElementChild as HTMLElement
				label.className = `map-teammate-name${fading ? " motion-safe:animate-pulse" : ""}`
				label.textContent = `${phone.name}${fading ? ` · ${Math.floor(phone.ageMs / 1000)} s` : ""}`
				marker.setLngLat([phone.lng, phone.lat])
			}
			const phoneIds = new Set(nextPhones.map(({ id }) => id))
			for (const [id, marker] of markers.current.phones) {
				if (phoneIds.has(id)) continue
				marker.remove()
				markers.current.phones.delete(id)
			}
			for (const phone of nextPhones) {
				let marker = markers.current.phones.get(phone.id)
				if (!marker) {
					const button = document.createElement("button")
					const dot = document.createElement("span")
					const label = document.createElement("span")
					const team = document.createElement("span")
					const name = document.createElement("span")
					button.type = "button"
					button.className = "map-phone-marker"
					dot.className = "map-phone-dot"
					label.className = "map-phone-label bg-z0/85"
					team.className = "map-phone-team"
					name.className = "map-phone-name"
					label.append(team, name)
					button.append(dot, label)
					button.addEventListener("click", () => selectPhone(phone.id))
					marker = new Marker({ element: button, draggable: false }).setLngLat([phone.lng, phone.lat]).addTo(map)
					markers.current.phones.set(phone.id, marker)
				}
				const button = marker.getElement() as HTMLButtonElement
				button.setAttribute("aria-label", `${phone.team} · ${phone.name}`)
				const dot = button.children[0] as HTMLSpanElement
				const label = button.children[1] as HTMLSpanElement
				const team = label.children[0] as HTMLSpanElement
				const name = label.children[1] as HTMLSpanElement
				dot.style.backgroundColor = phone.color
				team.textContent = phone.team
				team.style.color = phone.color
				name.textContent = ` · ${phone.name}`
				marker.setLngLat([phone.lng, phone.lat])
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
		map.on("click", (event) => {
			const target = event.originalEvent?.target
			if (target && "closest" in target && typeof target.closest === "function" && target.closest(".maplibregl-marker"))
				return
			create(event.lngLat)
		})
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
				const heldColor = getComputedStyle(container.current as HTMLDivElement)
					.getPropertyValue("--color-pace-ok")
					.trim()
				const paintColor: string | ExpressionSpecification =
					id === "place" ? ["case", ["get", "held"], heldColor, color] : color
				map.addLayer({
					id: `${id}-fill`,
					type: "fill",
					source: id,
					paint: { "fill-color": paintColor, "fill-opacity": 0.2 },
				})
				map.addLayer({
					id: `${id}-line`,
					type: "line",
					source: id,
					paint: { "line-color": paintColor, "line-width": id === "place" ? 2.5 : 1 },
				})
			}
			map.addSource("phones", { type: "geojson", data: phonePolygons([]) })
			const phoneColor: ExpressionSpecification = ["get", "color"]
			map.addLayer({
				id: "phones-fill",
				type: "fill",
				source: "phones",
				paint: { "fill-color": phoneColor, "fill-opacity": 0.2 },
			})
			map.addLayer({
				id: "phones-line",
				type: "line",
				source: "phones",
				paint: { "line-color": phoneColor, "line-width": 1 },
			})
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
			for (const marker of markers.current.teammates.values()) marker.remove()
			for (const marker of markers.current.phones.values()) marker.remove()
			markers.current = { places: {}, teammates: new Map(), phones: new Map() }
			map.remove()
			instance.current = null
		}
	}, [maxZoom, minZoom])

	useEffect(() => {
		updateSources(circles, dot, edit, interactive, teammates, phones)
	}, [circles, dot, edit, interactive, teammates, phones])
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
