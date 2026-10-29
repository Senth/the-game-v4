import { livePositionsChannel, publish } from "./bus"

const cache = globalThis as typeof globalThis & { theGameLivePositions?: Map<string, { pending: boolean }> }
cache.theGameLivePositions ??= new Map()
const pushes = cache.theGameLivePositions

export function publishLivePositions(seasonId: string): void {
	const existing = pushes.get(seasonId)
	if (existing) {
		existing.pending = true
		return
	}
	const state = { pending: false }
	pushes.set(seasonId, state)
	function flush() {
		state.pending = false
		publish(livePositionsChannel(seasonId))
		const timer = setTimeout(() => {
			if (state.pending) flush()
			else pushes.delete(seasonId)
		}, 1000)
		timer.unref?.()
	}
	flush()
}
