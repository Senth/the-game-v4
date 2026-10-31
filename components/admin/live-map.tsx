"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { getLivePhones } from "@/app/admin/live-map-actions"
import LazyMap from "@/components/map/lazy-map"
import { teamColor } from "@/lib/domain/live-map"
import { boundsFor, circleRing } from "@/lib/domain/map"
import { livePositionsChannel, seasonChannel } from "@/lib/events/bus"
import { createLiveConnection } from "@/lib/events/live-connection"
import type { LivePhones } from "@/lib/game/live-map"

type LivePhone = Extract<LivePhones, { live: true }>["phones"][number] & { expiresAt: number }
type LiveState =
	| { live: false }
	| {
			live: true
			mapArea: Extract<LivePhones, { live: true }>["mapArea"]
			teams: Extract<LivePhones, { live: true }>["teams"]
			places: Extract<LivePhones, { live: true }>["places"]
			phones: LivePhone[]
	  }

export function LiveMap({ seasonId }: { seasonId: string }) {
	const router = useRouter()
	const [state, setState] = useState<LiveState | null>(null)
	const [manual, setManual] = useState(false)

	useEffect(() => {
		const query = new URLSearchParams()
		query.append("channel", livePositionsChannel(seasonId))
		query.append("channel", seasonChannel(seasonId))
		const connection = createLiveConnection({
			url: `/api/events?${query}`,
			fetcher: () => getLivePhones(seasonId),
			onData: (data) => {
				const receivedLocally = Date.now()
				if (!data.live) {
					setManual(false)
					setState(data)
					return
				}
				setState({
					...data,
					phones: data.phones.map((phone) => ({ ...phone, expiresAt: receivedLocally + phone.expiresInMs })),
				})
			},
			createEventSource: (url) => new EventSource(url),
		})
		const onVisibilityChange = () => connection.setHidden(document.hidden)
		document.addEventListener("visibilitychange", onVisibilityChange)
		if (document.hidden) connection.setHidden(true)
		connection.start()
		return () => {
			document.removeEventListener("visibilitychange", onVisibilityChange)
			connection.stop()
		}
	}, [seasonId])

	const teams = state?.live ? state.teams : []
	const names = new Map(teams.map((team) => [team.id, team.name]))
	const colors = new Map(teams.map((team, index) => [team.id, teamColor(index, teams.length)]))
	const phones = state?.live
		? state.phones.filter((phone) => phone.expiresAt > Date.now() && names.has(phone.teamId))
		: []
	useEffect(() => {
		if (!state?.live || state.phones.length === 0) return
		const timer = setInterval(() => {
			const checkedAt = Date.now()
			setState((current) => {
				if (!current?.live) return current
				const phones = current.phones.filter((phone) => phone.expiresAt > checkedAt)
				return phones.length === current.phones.length ? current : { ...current, phones }
			})
		}, 1000)
		return () => clearInterval(timer)
	}, [state])

	const mapPhones = phones.flatMap((phone) => {
		const team = names.get(phone.teamId)
		const color = colors.get(phone.teamId)
		return team && color ? [{ ...phone, team, color }] : []
	})
	const teamPlaces = state?.live
		? state.places.flatMap((place) => {
				const placeColors = place.teamIds.flatMap((teamId) => {
					const color = colors.get(teamId)
					return color ? [color] : []
				})
				return placeColors.length ? [{ ...place, colors: placeColors }] : []
			})
		: []
	const mapArea = state?.live ? state.mapArea : null
	const framingPoints = [
		...mapPhones.map(({ lng, lat }) => [lng, lat] as [number, number]),
		...teamPlaces.flatMap((place) => circleRing(place, place.radius)),
	]
	const framing = manual ? null : framingPoints.length ? { bounds: boundsFor(framingPoints) } : mapArea
	const hasMap = state?.live && (mapPhones.length > 0 || teamPlaces.length > 0 || mapArea !== null)

	return (
		<div className="live-map flex min-h-0 flex-1 flex-col">
			{state?.live ? (
				<>
					<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-z1 px-4 py-3">
						<p className="font-cond text-sm text-ink">
							{mapPhones.length === 0
								? "No phones reporting"
								: `${mapPhones.length} ${mapPhones.length === 1 ? "phone" : "phones"} · ${new Set(mapPhones.map((phone) => phone.teamId)).size} of ${teams.length} teams`}
						</p>
						<p className="font-cond text-xs text-muted">Only phones on a location quest report</p>
					</div>
					{hasMap && (
						<div className="live-map-canvas relative min-h-0 flex-1">
							<LazyMap
								fill
								phones={mapPhones}
								teamPlaces={teamPlaces}
								framing={framing}
								refitBoundsOnResize
								onMoveEnd={(_, moved) => {
									if (moved) setManual(true)
								}}
								onPhoneSelect={(id) => {
									const phone = mapPhones.find((item) => item.id === id)
									if (phone) router.push(`/admin/seasons/${seasonId}/teams/${phone.teamId}`)
								}}
							/>
							{manual && (
								<button
									type="button"
									onClick={() => setManual(false)}
									className="absolute top-2 right-2 z-10 min-h-11 rounded-md bg-z0/90 px-3 font-cond text-xs text-link hover:text-head focus-visible:outline-2 focus-visible:outline-link active:text-head"
								>
									Recenter
								</button>
							)}
						</div>
					)}
				</>
			) : (
				<p className="px-4 py-4 font-cond text-sm text-muted">Phones appear here while the game runs.</p>
			)}
		</div>
	)
}
