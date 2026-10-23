"use client"

import { useEffect, useEffectEvent, useRef, useState } from "react"

export type LocationStatus = { state: "off" | "on" | "rough" | "blocked" | "unavailable"; accuracy?: number }

export function useLocationReporter(questId: string | null, onChange: () => void) {
	const [status, setStatus] = useState<LocationStatus>({ state: "off" })
	const start = useRef<() => void>(() => {})
	const changed = useEffectEvent(onChange)

	useEffect(() => {
		if (!questId) return
		let disposed = false
		let stopped = false
		let allowed = false
		let watch: number | undefined
		let permission: PermissionStatus | undefined
		let wake: WakeLockSentinel | undefined
		let wakeRequested = false
		let generation = 0
		let watchGeneration = 0
		let lastSent = -Infinity
		let request: AbortController | undefined
		setStatus({ state: navigator.geolocation ? "off" : "unavailable" })

		function stopWatching() {
			watchGeneration++
			if (watch !== undefined) navigator.geolocation.clearWatch(watch)
			watch = undefined
			request?.abort()
			request = undefined
		}
		function pause() {
			generation++
			stopWatching()
			void wake?.release().catch(() => {})
			wake = undefined
			wakeRequested = false
		}
		function watchLocation() {
			if (disposed || stopped || document.hidden || !allowed || watch !== undefined || !navigator.geolocation) return
			setStatus({ state: "on" })
			const currentGeneration = watchGeneration
			watch = navigator.geolocation.watchPosition(
				async (position) => {
					if (disposed || stopped || document.hidden || currentGeneration !== watchGeneration || !allowed) return
					const { latitude: lat, longitude: lng, accuracy } = position.coords
					setStatus({ state: accuracy > 50 ? "rough" : "on", accuracy })
					if (request || Date.now() - lastSent < 5000) return
					lastSent = Date.now()
					const controller = new AbortController()
					request = controller
					try {
						const response = await fetch("/api/location", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ questId, lat, lng, accuracy, at: position.timestamp }),
							signal: controller.signal,
						})
						if (!response.ok) return
						const result = await response.json()
						if (controller.signal.aborted) return
						if (result.status === "stop" || result.status === "solved") {
							stopped = true
							pause()
							changed()
						}
					} catch {
					} finally {
						if (request === controller) request = undefined
					}
				},
				(error) => {
					if (disposed || stopped || document.hidden || currentGeneration !== watchGeneration) return
					if (error.code === 1) {
						allowed = false
						stopWatching()
						setStatus({ state: "blocked" })
					} else setStatus({ state: "rough" })
				},
				{ enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
			)
		}
		function resume() {
			if (disposed || stopped || document.hidden) return
			if (navigator.wakeLock && !wakeRequested) {
				wakeRequested = true
				const currentGeneration = generation
				void navigator.wakeLock.request("screen").then(
					(lock) => {
						if (disposed || stopped || document.hidden || currentGeneration !== generation)
							void lock.release().catch(() => {})
						else wake = lock
					},
					() => {},
				)
			}
			watchLocation()
		}
		function permissionChanged() {
			if (disposed || stopped || !permission || !navigator.geolocation) return
			allowed = permission.state === "granted"
			if (allowed) watchLocation()
			else {
				stopWatching()
				setStatus({ state: permission.state === "denied" ? "blocked" : "off" })
			}
		}
		start.current = () => {
			allowed = true
			watchLocation()
		}
		function visibilityChanged() {
			if (document.hidden) pause()
			else resume()
		}
		document.addEventListener("visibilitychange", visibilityChanged)
		if (navigator.geolocation && navigator.permissions) {
			void navigator.permissions.query({ name: "geolocation" }).then(
				(value) => {
					if (disposed) return
					permission = value
					permission.addEventListener("change", permissionChanged)
					if (permission.state !== "prompt") permissionChanged()
				},
				() => {},
			)
		}
		resume()
		return () => {
			disposed = true
			start.current = () => {}
			pause()
			permission?.removeEventListener("change", permissionChanged)
			document.removeEventListener("visibilitychange", visibilityChanged)
		}
	}, [questId])

	return { ...status, share: () => start.current() }
}
