export type Listener = (event: { channel: string; data?: unknown }) => void

const cache = globalThis as typeof globalThis & { theGameBus?: Map<string, Set<Listener>> }
cache.theGameBus ??= new Map()
const bus = cache.theGameBus

export const boardChannel = "board"
export const teamChannel = (id: string) => `team:${id}`
export const seasonChannel = (id: string) => `season:${id}`
export const positionsChannel = (id: string) => `positions:${id}`
export const livePositionsChannel = (seasonId: string) => `live-positions:${seasonId}`

export function subscribe(channels: string[], listener: Listener): () => void {
	for (const channel of channels) {
		const listeners = bus.get(channel) ?? new Set()
		listeners.add(listener)
		bus.set(channel, listeners)
	}
	return () => {
		for (const channel of channels) {
			const listeners = bus.get(channel)
			listeners?.delete(listener)
			if (listeners?.size === 0) bus.delete(channel)
		}
	}
}

export function publish(channel: string, data?: unknown): void {
	for (const listener of [...(bus.get(channel) ?? [])]) {
		try {
			listener({ channel, ...(data === undefined ? {} : { data }) })
		} catch (error) {
			console.error(error)
		}
	}
}
