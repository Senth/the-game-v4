import type { EffectCallback, ReactElement, ReactNode } from "react"
import { isValidElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getLivePhones } from "@/app/admin/live-map-actions"
import type { MapViewProps } from "@/components/map/map-view"
import { teamColor } from "@/lib/domain/live-map"
import { createLiveConnection } from "@/lib/events/live-connection"
import type { LivePhones } from "@/lib/game/live-map"
import { LiveMap } from "./live-map"

const hooks = vi.hoisted(() => ({
	effects: [] as EffectCallback[],
	values: [] as unknown[],
	index: 0,
	mapProps: null as MapViewProps | null,
	router: { push: vi.fn() },
	connection: { start: vi.fn(), stop: vi.fn(), setHidden: vi.fn() },
}))

vi.mock("react", async (importOriginal) => {
	const react = await importOriginal<typeof import("react")>()
	return {
		...react,
		useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
		useState: (initial: unknown) => {
			const index = hooks.index++
			hooks.values[index] ??= initial
			return [
				hooks.values[index],
				(next: unknown) => {
					hooks.values[index] =
						typeof next === "function" ? (next as (value: unknown) => unknown)(hooks.values[index]) : next
				},
			]
		},
	}
})

vi.mock("next/navigation", () => ({ useRouter: () => hooks.router }))
vi.mock("@/app/admin/live-map-actions", () => ({ getLivePhones: vi.fn() }))
vi.mock("@/lib/events/live-connection", () => ({
	createLiveConnection: vi.fn(() => hooks.connection),
}))
vi.mock("@/components/map/lazy-map", () => ({
	default: (props: MapViewProps) => {
		hooks.mapProps = props
		return <div>Map renderer</div>
	},
}))

const now = new Date("2026-10-11T17:00:00Z").getTime()
const teams = [
	{ id: "team-byg", name: "Byggarna" },
	{ id: "team-ninjas", name: "Ninjas" },
	{ id: "team-rav", name: "Rävarna" },
]
const first = {
	id: "phone-record-1",
	teamId: "team-ninjas",
	name: "Brave Otter",
	lat: 55.52,
	lng: 13.21,
	accuracy: 20,
	expiresInMs: 30_000,
}
const live = (phones: (typeof first)[] = [], mapArea: Extract<LivePhones, { live: true }>["mapArea"] = null) =>
	({ live: true, mapArea, teams, phones }) satisfies LivePhones
const cleanups: (() => void)[] = []

function render() {
	hooks.index = 0
	hooks.effects = []
	return renderToStaticMarkup(<LiveMap seasonId="s1" />)
}

function mount() {
	render()
	for (const effect of hooks.effects) {
		const cleanup = effect()
		if (cleanup) cleanups.push(cleanup)
	}
}

function receive(data: LivePhones) {
	const options = vi.mocked(createLiveConnection).mock.calls[0]?.[0]
	if (!options) throw new Error("Live connection was not created")
	options.onData(data)
	render()
}

function findButton(node: ReactNode): ReactElement<{ onClick?: () => void; children?: ReactNode }> | undefined {
	if (Array.isArray(node)) {
		for (const child of node) {
			const button = findButton(child)
			if (button) return button
		}
		return undefined
	}
	if (!isValidElement<{ children?: ReactNode }>(node)) return undefined
	if (node.type === "button") return node as ReactElement<{ onClick?: () => void; children?: ReactNode }>
	return findButton(node.props.children)
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(now)
	vi.clearAllMocks()
	hooks.values = []
	hooks.effects = []
	hooks.index = 0
	hooks.mapProps = null
	hooks.router.push.mockReset()
	cleanups.length = 0
	vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }))
	vi.stubGlobal(
		"EventSource",
		vi.fn(function EventSourceMock() {}),
	)
})

afterEach(() => {
	for (const cleanup of cleanups) cleanup()
	cleanups.length = 0
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe("LiveMap", () => {
	it("subscribes to admin live positions and season changes, and fetches guarded data", async () => {
		const data = live()
		vi.mocked(getLivePhones).mockResolvedValue(data)
		mount()
		const options = vi.mocked(createLiveConnection).mock.calls[0]?.[0]
		expect(options?.url).toBe("/api/events?channel=live-positions%3As1&channel=season%3As1")
		expect(hooks.connection.start).toHaveBeenCalledOnce()
		expect(await options?.fetcher()).toBe(data)
		expect(getLivePhones).toHaveBeenCalledWith("s1")
	})

	it("shows live phone labels and generated colors; updates moved and added phones in place", () => {
		mount()
		receive(live([first]))
		expect(render()).toContain("1 phone · 1 of 3 teams")
		expect(render()).toContain("Only phones on a location quest report")
		expect(hooks.mapProps?.fill).toBe(true)
		expect(hooks.mapProps?.phones).toEqual([
			expect.objectContaining({
				id: first.id,
				team: "Ninjas",
				name: "Brave Otter",
				color: teamColor(1, 3),
			}),
		])

		const moved = { ...first, lat: 55.53, lng: 13.22 }
		const added = { ...first, id: "phone-record-2", teamId: "team-rav", name: "Swift Lynx" }
		receive(live([moved, added]))
		expect(render()).toContain("2 phones · 2 of 3 teams")
		expect(hooks.mapProps?.phones).toEqual([
			expect.objectContaining({ lat: moved.lat, lng: moved.lng, color: teamColor(1, 3) }),
			expect.objectContaining({ team: "Rävarna", color: teamColor(2, 3) }),
		])
	})

	it("drops a phone at its local expiry, without waiting for another push", async () => {
		mount()
		receive(live([{ ...first, expiresInMs: 1100 }]))
		const intervalEffect = hooks.effects[1]
		const cleanup = intervalEffect?.()
		if (cleanup) cleanups.push(cleanup)
		await vi.advanceTimersByTimeAsync(1000)
		expect(render()).toContain("1 phone · 1 of 3 teams")
		await vi.advanceTimersByTimeAsync(1000)
		hooks.mapProps = null
		expect(render()).toContain("No phones reporting")
		expect(hooks.mapProps).toBeNull()
	})

	it("shows map-area framing without phones and omits map when neither exists", () => {
		mount()
		receive(live())
		expect(render()).toContain("No phones reporting")
		expect(hooks.mapProps).toBeNull()

		const mapArea = { lat: 55.5, lng: 13.2, zoom: 12 }
		receive(live([], mapArea))
		expect(hooks.mapProps?.framing).toEqual(mapArea)
		expect(hooks.mapProps?.phones).toEqual([])
	})

	it("shows the not-running copy with no status line or map, and follows lifecycle changes", () => {
		mount()
		expect(render()).toContain("Phones appear here while the game runs.")
		expect(render()).not.toContain("Only phones on a location quest report")
		expect(hooks.mapProps).toBeNull()
		receive(live([first]))
		expect(render()).toContain("1 phone · 1 of 3 teams")
		receive({ live: false })
		hooks.mapProps = null
		expect(render()).toContain("Phones appear here while the game runs.")
		expect(render()).not.toContain("No phones reporting")
		expect(hooks.mapProps).toBeNull()
	})

	it("selects a phone's team, pauses framing after a pan, and resumes on Recenter", () => {
		mount()
		receive(live([first]))
		const onPhoneSelect = hooks.mapProps?.onPhoneSelect
		onPhoneSelect?.(first.id)
		expect(hooks.router.push).toHaveBeenCalledWith("/admin/seasons/s1/teams/team-ninjas")

		hooks.mapProps?.onMoveEnd?.({ lat: 1, lng: 2, zoom: 3 }, true)
		const pannedMarkup = render()
		expect(pannedMarkup).toContain(">Recenter<")
		expect(hooks.mapProps?.framing).toBeNull()
		hooks.index = 0
		hooks.effects = []
		const panned = LiveMap({ seasonId: "s1" }) as ReactElement<{ children: ReactNode }>
		const recenter = findButton(panned)
		expect(recenter?.props.children).toBe("Recenter")
		recenter?.props.onClick?.()
		expect(render()).not.toContain(">Recenter<")
		expect(hooks.mapProps?.framing).not.toBeNull()
	})
})
