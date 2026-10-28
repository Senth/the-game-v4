import type { EffectCallback, ReactElement } from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { dropPuzzlePiece, getGame, getSolvedLocation, getSolvedPuzzle } from "@/app/actions"
import { type PlayerGame, playerGame } from "@/lib/domain/player-game"
import type { Positions } from "@/lib/game/positions"
import { buildFixture } from "@/scripts/fixture"
import { GameScreen } from "./game-screen"
import type { GameView } from "./game-view"
import { useCompass } from "./use-compass"
import { useLocationReporter } from "./use-location-reporter"

const hooks = vi.hoisted(() => ({
	states: [] as unknown[],
	cursor: 0,
	dirty: false,
	game: null as PlayerGame | null,
	effect: undefined as EffectCallback | undefined,
	channels: [] as string[],
	scope: undefined as string | undefined,
	receivePositions: undefined as ((data: Positions) => void) | undefined,
}))
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (initial: unknown) => {
		const index = hooks.cursor++
		if (!(index in hooks.states)) hooks.states[index] = typeof initial === "function" ? initial() : initial
		return [
			hooks.states[index],
			(value: unknown) => {
				hooks.states[index] = typeof value === "function" ? value(hooks.states[index]) : value
				hooks.dirty = true
			},
		]
	},
	useEffect: (effect: EffectCallback) => {
		hooks.effect = effect
	},
	useCallback: (callback: unknown) => callback,
	useTransition: () => [false, (callback: () => void) => callback()],
}))
vi.mock("@/app/actions", () => ({
	getSolvedPuzzle: vi.fn(),
	getSolvedLocation: vi.fn(),
	getGame: vi.fn(),
	dropPuzzlePiece: vi.fn(),
	submitAnswer: vi.fn(),
	revealHint: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/lib/events/use-live-state", () => ({
	useLiveState: (
		_fetcher: unknown,
		channels: (state: PlayerGame) => string[],
		_initial: PlayerGame,
		options: { onPositions: (data: Positions) => void; scope: (state: PlayerGame) => string | undefined },
	) => {
		if (!hooks.game) throw new Error("Missing game")
		hooks.channels = channels(hooks.game)
		hooks.scope = options.scope(hooks.game)
		hooks.receivePositions = options.onPositions
		return [
			hooks.game,
			(next: PlayerGame) => {
				hooks.game = next
			},
		]
	},
}))
vi.mock("@/lib/events/use-finisher-notices", () => ({ useFinisherNotices: () => ({ notice: null }) }))
vi.mock("./use-game-clock", () => ({ useGameClock: () => new Date("2026-10-15T18:00:00Z") }))
vi.mock("./use-location-reporter", () => ({ useLocationReporter: vi.fn(() => ({ state: "off", share: vi.fn() })) }))
vi.mock("./use-compass", () => ({ useCompass: vi.fn(() => ({ state: "needsTap", request: vi.fn() })) }))

const now = new Date("2026-10-15T18:00:00Z")
const fixture = buildFixture(now)
const team = fixture.teams.find((team) => team.name === "Rävarna")
if (!team) throw new Error("Missing Rävarna fixture")
const base = playerGame(fixture.season, team, fixture.teams, now)
if (base.lifecycleState !== "running" || !base.quest) throw new Error("Expected puzzle fixture")
const nextQuest = { ...base.quest, id: "next", displayTitle: "Next quest" }
const initial: PlayerGame = {
	...base,
	quest: {
		...base.quest,
		hasAnswers: false,
		puzzle: {
			rows: 2,
			cols: 2,
			aspect: 2,
			fullUrl: null,
			pieces: ["d", "a", "c", "b"].map((id) => ({ id, spot: { x: 0, y: 0 } })),
		},
	},
}
const locationInitial: PlayerGame = {
	...initial,
	quest: { ...base.quest, puzzle: null, location: { guidance: "none" }, hasAnswers: false },
}
function render() {
	let view: ReactElement<Parameters<typeof GameView>[0]>
	do {
		hooks.dirty = false
		hooks.cursor = 0
		view = GameScreen({ initial, channels: [], initialNow: now.getTime() }) as typeof view
	} while (hooks.dirty)
	return view
}
beforeEach(() => {
	vi.useFakeTimers()
	vi.clearAllMocks()
	vi.mocked(useLocationReporter).mockImplementation(() => ({ state: "off", share: vi.fn() }))
	hooks.states = []
	hooks.game = initial
	vi.mocked(getSolvedPuzzle).mockResolvedValue({ ids: ["a", "b", "c", "d"], pointsEarned: 7 })
})
afterEach(() => vi.useRealTimers())

it("subscribes only on current map quests, scopes quest changes and clears positions on solve", () => {
	if (!locationInitial.quest) throw new Error("Expected location fixture")
	const quest = {
		...locationInitial.quest,
		location: { guidance: "map" as const, places: [{ lat: 55, lng: 13, radius: 40 }] },
	}
	hooks.game = { ...locationInitial, quest, phones: [{ name: "Bold Fox", you: true }] }
	render()
	expect(hooks.channels).toEqual([`positions:${base.teamId}`])
	expect(hooks.scope).toBe(quest.id)
	const data = { places: [{ held: true }], phones: [{ name: "Bold Fox", lat: 55, lng: 13, ageMs: 19_000, place: 1 }] }
	hooks.receivePositions?.(data)
	let view = render().props
	if (view.preview) throw new Error("Expected live game")
	expect(view.positions).toEqual(data)
	expect(view.you).toBe("Bold Fox")
	vi.advanceTimersByTime(1000)
	view = render().props
	if (view.preview) throw new Error("Expected live game")
	expect(view.positions?.phones[0]?.ageMs).toBe(20_000)
	vi.advanceTimersByTime(10_000)
	view = render().props
	if (view.preview) throw new Error("Expected live game")
	expect(view.positions).toEqual({ places: [{ held: false }], phones: [] })
	hooks.game = { ...locationInitial, quest: { ...quest, id: "next-map" } }
	render()
	expect(hooks.scope).toBe("next-map")
	expect(render().props).toHaveProperty("positions", undefined)
	hooks.game = { lifecycleState: "completed", teamId: base.teamId, score: 50, rank: 1, teamCount: 10, finishers: [] }
	render()
	expect(hooks.channels).toEqual([])
	expect(hooks.scope).toBeUndefined()
})

it.each(["none", "warmer"] as const)("does not subscribe to positions for %s guidance", (guidance) => {
	if (!locationInitial.quest) throw new Error("Expected location fixture")
	hooks.game = { ...locationInitial, quest: { ...locationInitial.quest, location: { guidance } } }
	render()
	expect(hooks.channels).toEqual([])
	expect(hooks.scope).toBeUndefined()
})

it.each(["next", "completed"])("holds a teammate's solved picture for 1.5 seconds before %s", async (destination) => {
	render()
	hooks.game =
		destination === "completed"
			? { lifecycleState: "completed", teamId: team._id, score: 140, rank: 1, teamCount: 10, finishers: [] }
			: { ...base, quest: nextQuest }
	expect(render().props.quest?.id).toBe(base.quest?.id)
	const cleanup = hooks.effect?.()
	await Promise.resolve()
	const solved = render()
	expect(getSolvedPuzzle).toHaveBeenCalledWith(base.quest?.id)
	expect(solved.props.puzzleComplete).toBe(7)
	expect(solved.props.quest?.puzzle?.pieces).toEqual(["a", "b", "c", "d"].map((id, cell) => ({ id, spot: { cell } })))
	expect("onPuzzleDrop" in solved.props && solved.props.onPuzzleDrop).toBeUndefined()
	vi.advanceTimersByTime(1499)
	expect(render().props.quest?.id).toBe(base.quest?.id)
	vi.advanceTimersByTime(1)
	const next = render()
	if (destination === "next") expect(next.props.quest?.id).toBe("next")
	else expect(next.props).toHaveProperty("game.lifecycleState", "completed")
	if (cleanup) cleanup()
})

it.each(["next", "completed"])("holds a teammate's location arrival for 1.5 seconds before %s", async (destination) => {
	hooks.game = locationInitial
	render()
	hooks.game =
		destination === "completed"
			? { lifecycleState: "completed", teamId: team._id, score: 140, rank: 1, teamCount: 10, finishers: [] }
			: { ...base, quest: nextQuest }
	vi.mocked(getSolvedLocation).mockResolvedValue({ pointsEarned: 12 })
	expect(render().props.quest?.id).toBe(initial.quest?.id)
	const cleanup = hooks.effect?.()
	await Promise.resolve()
	expect(getSolvedLocation).toHaveBeenCalledWith(initial.quest?.id)
	expect(getSolvedPuzzle).not.toHaveBeenCalled()
	expect(render().props.locationComplete).toBe(12)
	expect(render().props.puzzleComplete).toBeUndefined()
	vi.advanceTimersByTime(1499)
	expect(render().props.locationComplete).toBe(12)
	vi.advanceTimersByTime(1)
	if (destination === "next") expect(render().props.quest?.id).toBe("next")
	else expect(render().props).toHaveProperty("game.lifecycleState", "completed")
	if (cleanup) cleanup()
})

it("does not celebrate a skipped location quest", async () => {
	hooks.game = locationInitial
	render()
	hooks.game = { ...base, quest: null }
	vi.mocked(getSolvedLocation).mockResolvedValueOnce(null)
	render()
	hooks.effect?.()
	await Promise.resolve()
	expect(render().props.quest).toBeNull()
})

it("refetches a reporting phone's solve and stops reporting during the arrival hold", async () => {
	hooks.game = locationInitial
	vi.mocked(getGame).mockResolvedValue({ ...base, quest: nextQuest })
	vi.mocked(getSolvedLocation).mockResolvedValue({ pointsEarned: 12 })
	render()
	expect(useLocationReporter).toHaveBeenLastCalledWith(initial.quest?.id, expect.any(Function))
	vi.mocked(useLocationReporter).mock.lastCall?.[1]()
	await Promise.resolve()
	render()
	expect(useLocationReporter).toHaveBeenLastCalledWith(null, expect.any(Function))
	expect(useCompass).toHaveBeenLastCalledWith(null)
	const cleanup = hooks.effect?.()
	await Promise.resolve()
	expect(render().props.locationComplete).toBe(12)
	expect(getGame).toHaveBeenCalledOnce()
	if (cleanup) cleanup()
})

it("passes guidance and compass to the dock and requests both permissions from Share location", () => {
	if (!locationInitial.quest) throw new Error("Expected location fixture")
	hooks.game = { ...locationInitial, quest: { ...locationInitial.quest, location: { guidance: "warmer" } } }
	const guidance = { band: "close" as const, bearing: 42, trend: "warmer" as const }
	vi.mocked(useLocationReporter).mockReturnValue({ state: "on", guidance, share: vi.fn() })
	const props = render().props
	if (props.preview) throw new Error("Expected live location")
	expect(useCompass).toHaveBeenLastCalledWith(initial.quest?.id)
	expect(props.locationStatus?.guidance).toEqual(guidance)
	expect(props.compass).toBe(vi.mocked(useCompass).mock.results.at(-1)?.value)
	props.onShareLocation?.()
	expect(props.compass?.request).toHaveBeenCalledOnce()
	expect(vi.mocked(useLocationReporter).mock.results.at(-1)?.value.share).toHaveBeenCalledOnce()
	hooks.game = locationInitial
	render()
	expect(useCompass).toHaveBeenLastCalledWith(null)
})

it("does not celebrate a skipped puzzle and cancels a late solved response", async () => {
	render()
	hooks.game = { ...base, quest: null }
	vi.mocked(getSolvedPuzzle).mockResolvedValueOnce(null)
	render()
	hooks.effect?.()
	await Promise.resolve()
	expect(render().props.quest).toBeNull()
})

it("sends drops through the guarded action, refetches, and rejects stale writes for board rollback", async () => {
	vi.mocked(dropPuzzlePiece).mockResolvedValue({ status: "stale" })
	vi.mocked(getGame).mockResolvedValue(initial)
	const props = render().props
	if (props.preview || !props.onPuzzleDrop) throw new Error("Expected live puzzle")
	await expect(props.onPuzzleDrop("a", { cell: 2 })).rejects.toThrow("Puzzle drop rejected")
	expect(dropPuzzlePiece).toHaveBeenCalledWith(base.quest?.id, "a", { cell: 2 })
	expect(getGame).toHaveBeenCalledOnce()
})

it("shows persisted earnings after a concurrent hint reveal without an intermediate refetch on the solving phone", async () => {
	vi.mocked(dropPuzzlePiece).mockResolvedValue({ status: "solved", pointsEarned: 7 })
	vi.mocked(getGame).mockResolvedValue({ ...base, quest: nextQuest })
	const props = render().props
	if (props.preview || !props.onPuzzleDrop) throw new Error("Expected live puzzle")
	await props.onPuzzleDrop("d", { cell: 3 })
	render()
	hooks.effect?.()
	await Promise.resolve()
	expect(render().props.puzzleComplete).toBe(7)
	expect(getGame).toHaveBeenCalledOnce()
})
