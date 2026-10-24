"use client"

import { useEffect, useRef, useState } from "react"

export type CompassStatus = { state: "needsTap" | "on" | "refused" | "none"; heading?: number }

export function useCompass(questId: string | null) {
	const [status, setStatus] = useState<CompassStatus>({ state: "none" })
	const start = useRef<() => void>(() => {})
	const permission = useRef<"granted" | "denied" | undefined>(undefined)

	useEffect(() => {
		setStatus({ state: "none" })
		if (!questId || typeof DeviceOrientationEvent === "undefined") return
		const motion = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
			requestPermission?: () => Promise<string>
		}
		let disposed = false
		let generation = 0
		let heading: number | undefined
		let timer: ReturnType<typeof setTimeout> | undefined
		let requesting = false

		function reading(value: Event) {
			if (disposed || document.hidden) return
			const orientation = value as DeviceOrientationEvent & { webkitCompassHeading?: number }
			const raw =
				orientation.webkitCompassHeading ??
				((value.type === "deviceorientationabsolute" || orientation.absolute) && orientation.alpha != null
					? 360 - orientation.alpha
					: undefined)
			if (raw === undefined || !Number.isFinite(raw) || raw < 0 || raw > 360) return
			permission.current = "granted"
			const next = (((raw - (screen.orientation?.angle ?? 0)) % 360) + 360) % 360
			heading = heading === undefined ? next : (heading + (((next - heading + 540) % 360) - 180) * 0.2 + 360) % 360
			clearTimeout(timer)
			setStatus({ state: "on", heading })
		}
		function stop() {
			generation++
			heading = undefined
			clearTimeout(timer)
			window.removeEventListener("deviceorientation", reading)
			window.removeEventListener("deviceorientationabsolute", reading)
		}
		function listen() {
			if (disposed || document.hidden) return
			stop()
			const needsTap = !!motion.requestPermission && permission.current !== "granted"
			setStatus({ state: needsTap ? "needsTap" : "none" })
			window.addEventListener("deviceorientation", reading)
			window.addEventListener("deviceorientationabsolute", reading)
			timer = setTimeout(
				() => setStatus({ state: needsTap && permission.current !== "granted" ? "needsTap" : "none" }),
				2000,
			)
		}
		function resume() {
			if (document.hidden) return
			if (permission.current === "denied") {
				setStatus({ state: "refused" })
				return
			}
			listen()
			if (!motion.requestPermission || permission.current === "granted" || !navigator.permissions) return
			const current = generation
			void Promise.all(
				["accelerometer", "gyroscope", "magnetometer"].map((name) =>
					navigator.permissions.query({ name: name as PermissionName }),
				),
			).then(
				(states) => {
					if (disposed || document.hidden || requesting || current !== generation || permission.current !== undefined)
						return
					if (states.every(({ state }) => state === "granted")) {
						permission.current = "granted"
						setStatus({ state: "none" })
					} else if (states.some(({ state }) => state === "denied")) {
						permission.current = "denied"
						stop()
						setStatus({ state: "refused" })
					}
				},
				() => {},
			)
		}
		start.current = () => {
			if (disposed || document.hidden || requesting || !motion.requestPermission || permission.current === "granted")
				return
			requesting = true
			const current = generation
			void motion
				.requestPermission()
				.catch(() => "denied")
				.then((result) => {
					requesting = false
					if (disposed || document.hidden || current !== generation) return
					permission.current = result === "granted" ? "granted" : "denied"
					if (permission.current === "granted") listen()
					else {
						stop()
						setStatus({ state: "refused" })
					}
				})
		}
		function visibilityChanged() {
			if (document.hidden) {
				stop()
				setStatus({ state: "none" })
			} else resume()
		}
		document.addEventListener("visibilitychange", visibilityChanged)
		resume()
		return () => {
			disposed = true
			start.current = () => {}
			stop()
			document.removeEventListener("visibilitychange", visibilityChanged)
		}
	}, [questId])

	return { ...status, request: () => start.current() }
}
