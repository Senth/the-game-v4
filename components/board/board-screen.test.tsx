import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getBoard } from "@/app/board/actions"
import { type PublicBoard, publicBoard } from "@/lib/domain/player-game"
import { buildFixture } from "@/scripts/fixture"
import { BoardScreen } from "./board-screen"
import { BoardStage } from "./board-stage"
import { BoardTime } from "./board-time"

const hooks = vi.hoisted(() => ({
	effects: [] as EffectCallback[],
	state: null as PublicBoard | null,
	now: null as Date | null,
	scale: null as number | null,
	setState: vi.fn(),
}))

vi.mock("@/app/board/actions", () => ({ getBoard: vi.fn() }))
vi.mock("react", async (importOriginal) => {
	const react = await importOriginal<typeof import("react")>()
	return {
		...react,
		useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
		useEffectEvent: (callback: unknown) => callback,
		useTransition: () => [false, (callback: () => void) => callback()],
		useState: (initial: unknown) => {
			const [value, setter] = react.useState(initial)
			if (value instanceof Date)
				return [
					hooks.now ?? value,
					(next: Date) => {
						hooks.now = next
					},
				]
			if (value && typeof value === "object" && "view" in value) return [hooks.state ?? value, hooks.setState]
			if (typeof value === "number")
				return [
					hooks.scale ?? value,
					(next: number) => {
						hooks.scale = next
					},
				]
			return [value, setter]
		},
	}
})

const now = new Date("2026-10-11T18:00:00Z")
const fixture = buildFixture(now)
const teams = fixture.teams.map((team) => ({ ...team, passwordHash: "x" }))
const running = publicBoard([fixture.season], { [fixture.season._id]: teams }, now) as Extract<
	PublicBoard,
	{ view: "running" }
>
const props = { initial: running, initialNow: now.getTime(), channels: ["board"] }
let cleanups: (() => void)[] = []
let source = {
	readyState: 1,
	onopen: null as (() => void) | null,
	onmessage: null as (() => void) | null,
	onerror: null as (() => void) | null,
	close: vi.fn(),
}
let viewport: EventTarget & { innerWidth: number; innerHeight: number }

function render(initial: PublicBoard = running) {
	return renderToStaticMarkup(<BoardScreen {...props} initial={initial} />)
}

function mount(initial: PublicBoard = running) {
	render(initial)
	cleanups = hooks.effects.map((effect) => effect()).filter((cleanup): cleanup is () => void => !!cleanup)
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(now)
	vi.clearAllMocks()
	hooks.effects.length = 0
	hooks.state = null
	hooks.now = null
	hooks.scale = null
	hooks.setState.mockImplementation((next: PublicBoard) => {
		hooks.state = next
	})
	source = { readyState: 1, onopen: null, onmessage: null, onerror: null, close: vi.fn() }
	vi.stubGlobal(
		"EventSource",
		vi.fn(function EventSourceMock() {
			return source
		}),
	)
	vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }))
	viewport = Object.assign(new EventTarget(), { innerWidth: 1920, innerHeight: 1080 })
	vi.stubGlobal("window", viewport)
})

afterEach(() => {
	for (const cleanup of cleanups) cleanup()
	cleanups = []
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe("BoardScreen", () => {
	it("renders ten one-line rows, quiet title and time bar without actions, tint or small text", () => {
		const html = render()
		expect(html).toContain("Cipher Night 2026")
		expect(html.match(/<li /g)).toHaveLength(10)
		expect(html).toContain("bg-time")
		expect(html).toContain("text-5xl")
		expect(html).toContain("h-4")
		expect(html).toContain("64p")
		expect(html).toContain("5/12")
		for (const forbidden of ["bg-accent/15", "aria-current", "<button", "<a ", "behind", "ahead"])
			expect(html).not.toContain(forbidden)
		expect(html).not.toMatch(/\btext-(xs|sm|base|lg|xl|2xl)\b/)
		expect(html).toContain("truncate")
	})

	it("ticks from server time without changing initial hydration markup", async () => {
		const before = render()
		vi.setSystemTime(now.getTime() + 3_600_000)
		expect(render()).toBe(before)
		hooks.effects.length = 0
		mount()
		await vi.advanceTimersByTimeAsync(1000)
		expect(render()).toContain("1:12:31")
		expect(render()).toContain("47:29")
	})

	it("refetches only board events and updates points and rank", async () => {
		const next = publicBoard(
			[fixture.season],
			{
				[fixture.season._id]: teams.map((team) => (team.name === "Ninjas" ? { ...team, score: 200 } : team)),
			},
			now,
		)
		vi.mocked(getBoard).mockResolvedValue(next)
		mount()
		expect(EventSource).toHaveBeenCalledExactlyOnceWith("/api/events?channel=board")
		source.onmessage?.()
		await vi.advanceTimersByTimeAsync(0)
		expect(hooks.state).toEqual(next)
		const html = render()
		expect(html).toContain("200p")
		expect(html.indexOf(">Ninjas<")).toBeLessThan(html.indexOf(">Rävarna<"))
	})

	it("refetches at end without an event", async () => {
		const initial = { ...running, end: new Date(now.getTime() + 1000) }
		const final: PublicBoard = { view: "final", title: running.title, rows: running.rows, nextStart: null }
		vi.mocked(getBoard).mockResolvedValue(final)
		mount(initial)
		await vi.advanceTimersByTimeAsync(999)
		expect(getBoard).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		expect(getBoard).toHaveBeenCalledOnce()
		expect(hooks.state).toEqual(final)
		expect(render()).not.toContain("bg-time")
	})

	it.each(["final", "idle"] as const)("adapts %s nextStart to countdown clock", async (view) => {
		const nextStart = new Date(now.getTime() + 1000)
		const initial: PublicBoard =
			view === "idle" ? { view, nextStart } : { view, nextStart, rows: running.rows, title: running.title }
		vi.mocked(getBoard).mockResolvedValue(running)
		mount(initial)
		await vi.advanceTimersByTimeAsync(1000)
		expect(getBoard).toHaveBeenCalledOnce()
		expect(hooks.state).toEqual(running)
	})
})

describe("BoardStage", () => {
	it("renders unscaled on server, scales on mount and resize, then removes listener", () => {
		const stage = () => renderToStaticMarkup(<BoardStage>Content</BoardStage>)
		expect(stage()).toContain("scale(1)")
		expect(stage()).toContain("w-[1920px] h-[1080px]")
		viewport.innerWidth = 1280
		viewport.innerHeight = 720
		cleanups = hooks.effects.map((effect) => effect()).filter((cleanup): cleanup is () => void => !!cleanup)
		expect(hooks.scale).toBeCloseTo(2 / 3)
		viewport.innerWidth = 3840
		viewport.innerHeight = 2160
		viewport.dispatchEvent(new Event("resize"))
		expect(hooks.scale).toBe(2)
		viewport.innerWidth = 390
		viewport.innerHeight = 844
		viewport.dispatchEvent(new Event("resize"))
		expect(hooks.scale).toBe(390 / 1920)
		for (const cleanup of cleanups) cleanup()
		cleanups = []
		viewport.innerWidth = 1920
		viewport.dispatchEvent(new Event("resize"))
		expect(hooks.scale).toBe(390 / 1920)
	})
})

describe("BoardTime", () => {
	it("clamps elapsed and bar width at start and end and omits missing-duration bar", () => {
		const time = (at: Date, end = running.end) =>
			renderToStaticMarkup(<BoardTime start={running.start} end={end} now={at} />)
		expect(time(new Date(running.start.getTime() - 1))).toContain("width:0%")
		expect(time(new Date((running.end as Date).getTime() + 1))).toContain("width:100%")
		expect(time(now, null)).not.toContain("bg-time")
	})
})
