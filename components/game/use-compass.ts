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
		const event = motion.requestPermission ? "deviceorientation" : "deviceorientationabsolute"
		let disposed = false
		let generation = 0
		let heading: number | undefined
		let timer: ReturnType<typeof setTimeout> | undefined
		let requesting = false

		function reading(value: Event) {
			if (disposed || document.hidden) return
			const orientation = value as DeviceOrientationEvent & { webkitCompassHeading?: number }
			const raw = motion.requestPermission
				? orientation.webkitCompassHeading
				: orientation.alpha === null || orientation.alpha === undefined
					? undefined
					: 360 - orientation.alpha
			if (raw === undefined || !Number.isFinite(raw) || raw < 0 || raw > 360) return
			const next = (((raw - (screen.orientation?.angle ?? 0)) % 360) + 360) % 360
			heading = heading === undefined ? next : (heading + (((next - heading + 540) % 360) - 180) * 0.2 + 360) % 360
			clearTimeout(timer)
			setStatus({ state: "on", heading })
		}
		function stop() {
			generation++
			heading = undefined
			clearTimeout(timer)
			window.removeEventListener(event, reading)
		}
		function listen() {
			if (disposed || document.hidden) return
			stop()
			setStatus({ state: "none" })
			window.addEventListener(event, reading)
			timer = setTimeout(() => setStatus({ state: "none" }), 2000)
		}
		function resume() {
			if (document.hidden) return
			if (motion.requestPermission && permission.current !== "granted")
				setStatus({ state: permission.current === "denied" ? "refused" : "needsTap" })
			else listen()
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
					else setStatus({ state: "refused" })
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
