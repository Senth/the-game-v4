import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getBoard } from "@/app/board/actions"
import { type PublicBoard, publicBoard } from "@/lib/domain/player-game"
import { buildFixture } from "@/scripts/fixture"
import { BoardList } from "./board-list"
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
const final: PublicBoard = { view: "final", title: running.title, rows: running.rows, finishers: [], nextStart: null }
const rowsFor = (count: number) =>
	Array.from({ length: count }, (_, index) => ({
		...(running.rows[index % running.rows.length] as (typeof running.rows)[number]),
		id: `row-${index + 1}`,
		name: `Team ${index + 1}`,
		rank: index + 1,
	}))
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
	it("renders final ranking and Final alone instead of time bar", () => {
		const html = render(final)
		expect(html).toContain('font-cond text-5xl font-bold text-head">Final</')
		expect(html.match(/<li /g)).toHaveLength(10)
		expect(html).toContain("Cipher Night 2026")
		for (const forbidden of ["bg-time", "elapsed", "left", "<button", "<a ", "aria-current"])
			expect(html).not.toContain(forbidden)
	})

	it("centers exact idle text, without title or list", () => {
		const html = render({ view: "idle", nextStart: null })
		expect(html).toContain('<main class="flex h-full items-center justify-center">')
		expect(html).toContain('<p class="font-cond text-4xl text-muted">No game running</p>')
		for (const forbidden of ["<ol", "<h1", "bg-time", "<button", "<a "]) expect(html).not.toContain(forbidden)
	})

	it.each([final, { view: "idle", nextStart: null } as PublicBoard])(
		"switches live to $view without reload",
		async (next) => {
			vi.mocked(getBoard).mockResolvedValue(next)
			mount()
			source.onmessage?.()
			await vi.advanceTimersByTimeAsync(0)
			expect(render()).toContain(next.view === "final" ? ">Final<" : ">No game running<")
			expect(render()).not.toContain("bg-time")
		},
	)

	it("reserves title and footer while giving list only remaining height", () => {
		const html = render({ ...running, rows: rowsFor(12) })
		expect(html).toContain('class="flex min-h-0 flex-1 flex-col"')
		expect(html).toContain('class="mb-4 shrink-0 font-cond text-[28px]')
		expect(html).toContain('class="shrink-0"')
		expect(html).toContain("repeat(12, minmax(0, 76px))")
	})

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
		const initial = { ...running, end: new Date(now.getTime() + 1000), nextStart: new Date(now.getTime() + 2000) }
		const final: PublicBoard = {
			view: "final",
			title: running.title,
			rows: running.rows,
			finishers: [],
			nextStart: null,
		}
		vi.mocked(getBoard).mockResolvedValue(final)
		mount(initial)
		await vi.advanceTimersByTimeAsync(999)
		expect(getBoard).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		expect(getBoard).toHaveBeenCalledOnce()
		expect(hooks.state).toEqual(final)
		expect(render()).not.toContain("bg-time")
		expect(render()).toContain(">Final<")
	})

	it.each([null, new Date(now.getTime() + 2000)])(
		"switches to overlapping scheduled season without an event when current end is %s",
		async (end) => {
			const nextStart = new Date(now.getTime() + 1000)
			const overlap = { ...fixture.season, _id: "overlap", title: "Next game", start: nextStart, end: null }
			const seasons = [{ ...fixture.season, end }, overlap]
			const teamsBySeason = { [fixture.season._id]: teams }
			const initial = publicBoard(seasons, teamsBySeason, now)
			const next = publicBoard(seasons, teamsBySeason, nextStart)
			vi.mocked(getBoard).mockResolvedValue(next)
			mount(initial)
			expect(render(initial)).toContain("Cipher Night 2026")
			await vi.advanceTimersByTimeAsync(999)
			expect(getBoard).not.toHaveBeenCalled()
			await vi.advanceTimersByTimeAsync(1)
			expect(getBoard).toHaveBeenCalledOnce()
			expect(hooks.state).toEqual(next)
			expect(render()).toContain("Next game")
			expect(render()).not.toContain("Cipher Night 2026")
		},
	)

	it.each(["final", "idle"] as const)("adapts %s nextStart to countdown clock", async (view) => {
		const nextStart = new Date(now.getTime() + 1000)
		const initial: PublicBoard =
			view === "idle"
				? { view, nextStart }
				: { view, nextStart, rows: running.rows, title: running.title, finishers: [] }
		vi.mocked(getBoard).mockResolvedValue(running)
		mount(initial)
		expect(render(initial)).toContain(view === "idle" ? ">No game running<" : ">Final<")
		await vi.advanceTimersByTimeAsync(1000)
		expect(getBoard).toHaveBeenCalledOnce()
		expect(hooks.state).toEqual(running)
		expect(render()).toContain("bg-time")
		expect(render()).not.toContain(view === "idle" ? ">No game running<" : ">Final<")
	})
})

describe("BoardList", () => {
	it.each([
		[12, [12]],
		[13, [7, 6]],
		[14, [7, 7]],
		[23, [12, 11]],
		[24, [12, 12]],
		[25, [12, 12]],
	] as const)("splits %i teams top-to-bottom and clips beyond 24", (count, lengths) => {
		const rows = rowsFor(count)
		const before = structuredClone(rows)
		const html = renderToStaticMarkup(<BoardList rows={rows} />)
		const columns = html.match(/<ol\b.*?<\/ol>/g) ?? []
		expect(columns.map((column) => column.match(/<li /g)?.length ?? 0)).toEqual(lengths)
		const firstRanks = Array.from(columns[0]?.matchAll(/text-3xl text-muted">(\d+)<\/span>/g) ?? [], (match) =>
			Number(match[1]),
		)
		expect(firstRanks).toEqual(Array.from({ length: lengths[0] }, (_, index) => index + 1))
		if (columns.length === 2) {
			expect(html).toContain("grid-cols-2 gap-x-16")
			for (const column of columns) {
				expect(column).toContain(`repeat(${lengths[0]}, minmax(0, 76px))`)
				expect(column).toContain("h-4")
			}
		}
		expect(html).not.toContain(">Team 25<")
		expect(rows).toEqual(before)
	})

	it("truncates long names in narrower shrinkable two-column children", () => {
		const name = "VeryLongTeamName".repeat(10)
		const html = renderToStaticMarkup(<BoardList rows={rowsFor(14).map((row) => ({ ...row, name }))} />)
		expect(html).toContain('class="w-[15rem] flex min-w-0 items-center gap-2 text-4xl text-ink"')
		expect(html).toContain('class="truncate"')
		expect(html).toContain(name)
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
