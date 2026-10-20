import type { EffectCallback, SetStateAction } from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { PlayerFinisher } from "@/lib/domain/finishers"
import { useFinisherNotices } from "./use-finisher-notices"

const hooks = vi.hoisted(() => ({
	state: undefined as unknown,
	effect: undefined as EffectCallback | undefined,
	dependencies: undefined as unknown[] | undefined,
	cleanup: undefined as (() => void) | undefined,
	dirty: false,
}))

vi.mock("react", () => ({
	useState: (initial: () => unknown) => {
		if (hooks.state === undefined) hooks.state = initial()
		return [
			hooks.state,
			(next: SetStateAction<unknown>) => {
				hooks.state = typeof next === "function" ? next(hooks.state) : next
				hooks.dirty = true
			},
		]
	},
	useEffect: (effect: EffectCallback, dependencies: unknown[]) => {
		if (dependencies.some((value, index) => value !== hooks.dependencies?.[index])) {
			hooks.effect = effect
			hooks.dependencies = dependencies
		}
	},
}))

const first = { teamId: "first", name: "Rävarna", place: 1, points: 50 }
const second = { teamId: "second", name: "Team Kaos", place: 2, points: 20 }
const third = { teamId: "third", name: "Fjällräv", place: 3, points: 0 }

function render(finishers: PlayerFinisher[] | undefined, ownTeamId?: string, scope = "season") {
	let result: ReturnType<typeof useFinisherNotices>
	do {
		hooks.dirty = false
		result = useFinisherNotices(finishers, scope, ownTeamId)
	} while (hooks.dirty)
	if (hooks.effect) {
		hooks.cleanup?.()
		hooks.cleanup = hooks.effect() || undefined
		hooks.effect = undefined
	}
	return result
}

beforeEach(() => {
	vi.useFakeTimers()
	hooks.state = undefined
	hooks.dependencies = undefined
})

afterEach(() => {
	hooks.cleanup?.()
	hooks.cleanup = undefined
	vi.useRealTimers()
})

it("sets first-load baseline without replay, including after waiting", () => {
	expect(render(undefined).notice).toBeNull()
	expect(render([first]).notice).toBeNull()
	expect(render([first, second]).notice).toEqual(second)
})

it("queues each new finish once, in place order, without resetting its timer on refetch", () => {
	render([])
	const finishers = [third, first, second]
	expect(render(finishers).notice).toEqual(first)
	vi.advanceTimersByTime(4000)
	expect(render(structuredClone(finishers)).notice).toEqual(first)
	vi.advanceTimersByTime(4000)
	expect(render(finishers)).toMatchObject({ notice: first, closing: true })
	vi.advanceTimersByTime(250)
	expect(render(finishers)).toMatchObject({ notice: second, closing: false })
	vi.advanceTimersByTime(8000)
	render(finishers)
	vi.advanceTimersByTime(250)
	expect(render(finishers).notice).toEqual(third)
	vi.advanceTimersByTime(6000)
	expect(render(finishers).closing).toBe(true)
	vi.advanceTimersByTime(250)
	expect(render(finishers).notice).toBeNull()
	expect(render(structuredClone(finishers)).notice).toBeNull()
})

it("skips own team, dismisses on tap, and appends finishes arriving during exit", () => {
	render([], first.teamId)
	const finishers = [first, second]
	const result = render(finishers, first.teamId)
	expect(result.notice).toEqual(second)
	result.dismiss()
	expect(render([...finishers, third], first.teamId).closing).toBe(true)
	vi.advanceTimersByTime(250)
	expect(render([...finishers, third], first.teamId).notice).toEqual(third)
})

it("clears notices when leaving play or switching seasons and cancels timers on unmount", () => {
	render([])
	render([first])
	expect(render(undefined).notice).toBeNull()
	expect(render([first, second], undefined, "next-season").notice).toBeNull()
	render([first, second, third], undefined, "next-season")
	hooks.cleanup?.()
	expect(vi.getTimerCount()).toBe(0)
})
