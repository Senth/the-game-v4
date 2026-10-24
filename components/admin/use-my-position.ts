"use client"

import { useEffect, useEffectEvent, useRef, useState } from "react"
import { maxFixAccuracy } from "@/lib/domain/location"
import { roundCoordinate } from "@/lib/domain/map"
import type { Place } from "@/lib/domain/schemas"

export function useMyPosition(enabled: boolean, onPosition: (point: Pick<Place, "lat" | "lng">) => void) {
	const [status, setStatus] = useState({
		waiting: false,
		accuracy: null as number | null,
		error: null as string | null,
	})
	const actions = useRef({ start: () => {}, cancel: () => {} })
	const found = useEffectEvent(onPosition)

	useEffect(() => {
		let active = false
		let disposed = false
		let watch: number | undefined
		let timer: ReturnType<typeof setTimeout> | undefined
		let generation = 0
		function stop() {
			active = false
			generation++
			clearTimeout(timer)
			if (watch !== undefined) navigator.geolocation.clearWatch(watch)
			watch = undefined
		}
		function finish(error: string | null = null) {
			stop()
			setStatus({ waiting: false, accuracy: null, error })
		}
		actions.current = {
			cancel: () => finish(),
			start() {
				if (!enabled || disposed || active) return
				if (!navigator.geolocation) {
					finish("This browser can't share location.")
					return
				}
				active = true
				const current = ++generation
				setStatus({ waiting: true, accuracy: null, error: null })
				timer = setTimeout(() => finish("Couldn't get within 50 m. Try outside."), 30_000)
				try {
					const id = navigator.geolocation.watchPosition(
						({ coords }) => {
							if (!active || disposed || current !== generation) return
							const { latitude: lat, longitude: lng, accuracy } = coords
							if (
								![lat, lng, accuracy].every(Number.isFinite) ||
								accuracy < 0 ||
								Math.abs(lat) > 90 ||
								Math.abs(lng) > 180
							)
								return
							if (accuracy > maxFixAccuracy) {
								setStatus({ waiting: true, accuracy: Math.round(accuracy), error: null })
								return
							}
							finish()
							found({ lat: roundCoordinate(lat), lng: roundCoordinate(lng) })
						},
						({ code }) => {
							if (!active || disposed || current !== generation) return
							finish(
								code === 1
									? "Location blocked. Allow it for this site, then try again."
									: code === 3
										? "Couldn't get within 50 m. Try outside."
										: "Location unavailable. Try again outside.",
							)
						},
						{ enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
					)
					if (active) watch = id
					else navigator.geolocation.clearWatch(id)
				} catch {
					finish("This browser can't share location.")
				}
			},
		}
		setStatus({ waiting: false, accuracy: null, error: null })
		return () => {
			disposed = true
			stop()
		}
	}, [enabled])

	return { ...status, start: () => actions.current.start(), cancel: () => actions.current.cancel() }
}
