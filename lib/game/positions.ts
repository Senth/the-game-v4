import { listTeamPhones } from "@/lib/db/phones"
import { getSeason } from "@/lib/db/seasons"
import { getTeam } from "@/lib/db/teams"
import { currentQuest, lifecycleState } from "@/lib/domain/game"
import { fixTtlMs, placeCoverage, positionsPushMs } from "@/lib/domain/location"
import { positionsChannel, publish } from "@/lib/events/bus"
import { teamFixes } from "./location-fixes"

export type Positions = {
	places: { held: boolean }[]
	phones: { name: string; lat: number; lng: number; ageMs: number; place?: number }[]
}

type Push = { lastPush: number; empty?: boolean; timer?: ReturnType<typeof setTimeout>; pending?: Promise<void> }
const cache = globalThis as typeof globalThis & { theGamePositions?: Map<string, Push> }
cache.theGamePositions ??= new Map()
const pushes = cache.theGamePositions

function discard(teamId: string, state: Push) {
	clearTimeout(state.timer)
	if (pushes.get(teamId) === state) pushes.delete(teamId)
}

async function pushPositions(teamId: string, state: Push): Promise<void> {
	if (state.empty) {
		state.empty = false
		state.lastPush = Date.now()
		publish(positionsChannel(teamId), { places: [], phones: [] } satisfies Positions)
		if (teamFixes(teamId).length) arm(teamId, state, positionsPushMs)
		else {
			state.timer = setTimeout(() => discard(teamId, state), positionsPushMs)
			state.timer.unref?.()
		}
		return
	}
	const team = await getTeam(teamId)
	const [season, phones] = await Promise.all([team ? getSeason(team.seasonId) : null, listTeamPhones(teamId)])
	if (pushes.get(teamId) !== state) return
	const now = Date.now()
	const location = season && team && currentQuest(season, team)?.quest.location
	if (!season || !team || lifecycleState(season, team, new Date(now)) !== "running" || location?.guidance !== "map") {
		discard(teamId, state)
		return
	}
	const names = new Map(phones.map(({ phoneId, name }) => [phoneId, name]))
	const fixes = teamFixes(teamId, now)
	const named = fixes.filter(({ phoneId }) => names.has(phoneId))
	const { held } = placeCoverage(location.places, new Map(named.map(({ phoneId, fix }) => [phoneId, fix])))
	const data: Positions = {
		places: held.map((phone) => ({ held: phone !== null })),
		phones: named.map(({ phoneId, fix, ageMs }) => {
			const place = held.indexOf(phoneId) + 1
			return {
				name: names.get(phoneId) as string,
				lat: fix.lat,
				lng: fix.lng,
				ageMs,
				...(place ? { place } : {}),
			}
		}),
	}
	state.lastPush = now
	publish(positionsChannel(teamId), data)
	if (fixes.length) {
		const expiresIn = Math.min(...fixes.map(({ ageMs }) => fixTtlMs - ageMs + 1))
		arm(teamId, state, Math.max(positionsPushMs, expiresIn))
	} else {
		state.timer = setTimeout(() => discard(teamId, state), positionsPushMs)
		state.timer.unref?.()
	}
}

function arm(teamId: string, state: Push, delay: number) {
	clearTimeout(state.timer)
	state.timer = setTimeout(() => {
		state.timer = undefined
		void schedulePositions(teamId).catch((error) => console.error(error))
	}, delay)
	state.timer.unref?.()
}

export async function schedulePositions(teamId: string): Promise<void> {
	const state = pushes.get(teamId) ?? { lastPush: Number.NEGATIVE_INFINITY }
	pushes.set(teamId, state)
	if (state.pending) return state.pending
	const delay = state.lastPush + positionsPushMs - Date.now()
	if (delay > 0) {
		arm(teamId, state, delay)
		return
	}
	clearTimeout(state.timer)
	state.pending = pushPositions(teamId, state)
	try {
		await state.pending
	} finally {
		state.pending = undefined
	}
}

export function clearPositions(teamId: string): void {
	const previous = pushes.get(teamId)
	if (previous) discard(teamId, previous)
	const state: Push = { lastPush: previous?.lastPush ?? Number.NEGATIVE_INFINITY, empty: true }
	pushes.set(teamId, state)
	void schedulePositions(teamId).catch((error) => console.error(error))
}
