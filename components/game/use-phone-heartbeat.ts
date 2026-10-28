"use client"

import { useEffect } from "react"
import { pingPhone } from "@/app/actions"
import type { PlayerPhone } from "@/lib/domain/player-game"

export function usePhoneHeartbeat(onPhones: (phones: PlayerPhone[]) => void) {
	useEffect(() => {
		if (typeof document === "undefined") return
		let interval: ReturnType<typeof setInterval> | undefined
		let visible = !document.hidden
		let live = true

		function stop() {
			if (interval !== undefined) clearInterval(interval)
			interval = undefined
		}

		function start() {
			if (interval !== undefined || document.hidden) return
			interval = setInterval(ping, 120_000)
		}

		function ping() {
			void pingPhone().then(
				({ phones }) => {
					if (live) onPhones(phones)
				},
				() => {},
			)
		}

		function visibilityChanged() {
			if (document.hidden) {
				visible = false
				stop()
			} else if (!visible) {
				visible = true
				ping()
				start()
			}
		}

		start()
		document.addEventListener("visibilitychange", visibilityChanged)
		return () => {
			live = false
			stop()
			document.removeEventListener("visibilitychange", visibilityChanged)
		}
	}, [onPhones])
}
