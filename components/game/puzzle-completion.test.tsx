import type { EffectCallback, ReactElement } from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { dropPuzzlePiece, getGame, getSolvedPuzzle } from "@/app/actions"
import { type PlayerGame, playerGame } from "@/lib/domain/player-game"
import { buildFixture } from "@/scripts/fixture"
import { GameScreen } from "./game-screen"
import type { GameView } from "./game-view"

const hooks = vi.hoisted(() => ({
	states: [] as unknown[],
	cursor: 0,
	dirty: false,
	game: null as PlayerGame | null,
	effect: undefined as EffectCallback | undefined,
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
	getGame: vi.fn(),
	dropPuzzlePiece: vi.fn(),
	submitAnswer: vi.fn(),
	revealHint: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/lib/events/use-live-state", () => ({
	useLiveState: () => [
		hooks.game,
		(next: PlayerGame) => {
			hooks.game = next
		},
	],
}))
vi.mock("@/lib/events/use-finisher-notices", () => ({ useFinisherNotices: () => ({ notice: null }) }))
vi.mock("./use-game-clock", () => ({ useGameClock: () => new Date("2026-10-15T18:00:00Z") }))

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
	hooks.states = []
	hooks.game = initial
	vi.mocked(getSolvedPuzzle).mockResolvedValue({ ids: ["a", "b", "c", "d"], pointsEarned: 7 })
})
afterEach(() => vi.useRealTimers())

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
