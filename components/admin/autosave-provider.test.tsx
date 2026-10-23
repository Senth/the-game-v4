import { Children, type EffectCallback, isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { getPuzzlePreviewAssets } from "@/app/admin/actions"
import { patchSeasonList, removeLastFinisherBonus, saveSeasonField } from "@/app/admin/autosave-actions"
import TeamPage from "@/app/admin/seasons/[seasonId]/teams/[teamId]/page"
import TeamsPage from "@/app/admin/seasons/[seasonId]/teams/page"
import { addQuest, moveQuest, removeArc, removeQuest } from "@/app/admin/tree-actions"
import { getSeason } from "@/lib/db/seasons"
import { listSeasonTeams } from "@/lib/db/teams"
import type { Season } from "@/lib/domain/schemas"
import { createLiveConnection } from "@/lib/events/live-connection"
import { buildFixture } from "@/scripts/fixture"
import { AdminFrame } from "./admin-frame"
import {
	AutosaveProvider,
	useAssetDraft,
	useAutosaveField,
	useAutosaveList,
	useDraftHints,
	useDraftValue,
} from "./autosave-provider"
import { FinisherBonusRows } from "./finisher-bonus-rows"
import { QuestEditor } from "./quest-editor"
import { QuestPreview } from "./quest-preview"
import { AutosaveHeader, SaveStatus } from "./save-status"
import { SeasonPreview } from "./season-preview"
import { SeasonTree } from "./season-tree"
import { useMoveQueue } from "./sortable/use-move-queue"
import { usePuzzlePreviewAssets } from "./use-puzzle-preview-assets"

type Scope = {
	values: unknown[]
	cursor: number
	effects: Map<number, { deps: unknown[]; cleanup?: () => void }>
	pending: (() => void)[]
}

const hooks = vi.hoisted(() => ({
	active: null as unknown as Scope,
	context: null as unknown,
	refresh: vi.fn(),
	push: vi.fn(),
	connection: { start: vi.fn(), stop: vi.fn(), setHidden: vi.fn() },
	segments: [] as string[],
}))

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: unknown) => {
		const scope = hooks.active
		const index = scope.cursor++
		if (!(index in scope.values)) scope.values[index] = typeof initial === "function" ? initial() : initial
		return [
			scope.values[index],
			(next: unknown) => {
				scope.values[index] = typeof next === "function" ? next(scope.values[index]) : next
			},
		]
	},
	useRef: (initial: unknown) => {
		const scope = hooks.active
		const index = scope.cursor++
		scope.values[index] ??= { current: initial }
		return scope.values[index]
	},
	useId: () => "test-field",
	useContext: () => hooks.context,
	useEffectEvent: (callback: () => void) => callback,
	useEffect: (effect: EffectCallback, deps: unknown[]) => {
		const scope = hooks.active
		const index = scope.cursor++
		const previous = scope.effects.get(index)
		if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return
		scope.pending.push(() => {
			previous?.cleanup?.()
			const cleanup = effect()
			scope.effects.set(index, { deps, cleanup: cleanup || undefined })
		})
	},
}))
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: hooks.refresh, push: hooks.push }),
	useSelectedLayoutSegments: () => hooks.segments,
}))
vi.mock("@/app/admin/autosave-actions", () => ({
	saveSeasonField: vi.fn(),
	patchSeasonList: vi.fn(),
	removeLastFinisherBonus: vi.fn(),
}))
vi.mock("@/app/admin/tree-actions", () => ({
	removeArc: vi.fn(),
	removeQuest: vi.fn(),
	addArc: vi.fn(),
	addQuest: vi.fn(),
	moveQuest: vi.fn(),
}))
vi.mock("@/lib/events/live-connection", () => ({ createLiveConnection: vi.fn(() => hooks.connection) }))
vi.mock("@/app/admin/actions", () => ({ getPuzzlePreviewAssets: vi.fn() }))
vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/db/seasons", () => ({ getSeason: vi.fn() }))
vi.mock("@/lib/db/teams", () => ({ listSeasonTeams: vi.fn() }))
vi.mock("@/app/admin/team-actions", () => ({ createTeamAction: vi.fn(), deleteTeamAction: vi.fn() }))

function scope(): Scope {
	return { values: [], cursor: 0, effects: new Map(), pending: [] }
}

function render<T>(state: Scope, run: () => T, flushEffects = true): T {
	hooks.active = state
	state.cursor = 0
	const result = run()
	if (flushEffects) for (const effect of state.pending.splice(0)) effect()
	return result
}

function unmount(state: Scope) {
	for (const effect of state.effects.values()) effect.cleanup?.()
}

type TreeArcProps = {
	children?: ReactNode
	onAdd: () => void
	onRemove: () => void
	onMove: (target: { kind: "quest"; id: string; toArcId: string; beforeId: string | null }) => void
}
function firstTreeArc(node: ReactNode): ReactElement<TreeArcProps> | undefined {
	for (const child of Children.toArray(node)) {
		if (!isValidElement<TreeArcProps>(child)) continue
		if (typeof child.props.onAdd === "function") return child
		const nested = firstTreeArc(child.props.children)
		if (nested) return nested
	}
}

function provider(
	state = scope(),
	timing = { start: null as Date | null, end: null as Date | null, now: Date.now() },
	bonuses: Pick<Season, "finisherBonuses" | "finishers"> = { finisherBonuses: [], finishers: [] },
) {
	const element = render(state, () => AutosaveProvider({ seasonId: "season-1", ...timing, ...bonuses, children: null }))
	hooks.context = element.props.value
	return { state, context: element.props.value }
}

const moveFirst = (items: string[], id: string) => [id, ...items.filter((item) => item !== id)]

it.each(["list", "history"])(
	"refreshes server-derived team %s at clock boundaries without SSE events",
	async (surface) => {
		const now = Date.now()
		const fixture = buildFixture(new Date(now))
		const season = { ...fixture.season, start: new Date(now + 2000), end: new Date(now + 4000) }
		vi.mocked(getSeason).mockResolvedValue(season)
		vi.mocked(listSeasonTeams).mockResolvedValue(fixture.teams)
		const teamId = fixture.teams.find((team) => team.name === "Ninjas")?._id
		if (!teamId) throw new Error("Missing Ninjas fixture")
		const load = () => {
			const props = { params: Promise.resolve({ seasonId: season._id, teamId }), searchParams: Promise.resolve({}) }
			return surface === "list" ? TeamsPage(props) : TeamPage(props)
		}
		const state = scope()
		const timing = { start: season.start, end: season.end, now }
		const tick = () => provider(state, timing)
		let page = await load()
		const markup = () => render(scope(), () => renderToStaticMarkup(page))
		let html = markup()
		expect(html).not.toContain('aria-current="step"')
		expect(html).not.toContain("w-5 shrink-0 text-xs text-muted")
		expect(html).not.toContain("On <span")
		if (surface === "history") expect(html).toContain("Not started")
		tick()
		expect(hooks.refresh).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(2000)
		tick()
		expect(hooks.refresh).toHaveBeenCalledTimes(1)
		page = await load()
		html = markup()
		expect(html).toContain('aria-current="step"')
		if (surface === "list") {
			expect(html).toContain("w-5 shrink-0 text-xs text-muted")
			expect(html).toContain("On <span")
		} else {
			expect(html).not.toContain("w-5 shrink-0 text-xs text-muted")
			expect(html).toContain('aria-label="Current"')
			expect(html).toContain(">Now<")
		}
		timing.now = Date.now()
		tick()
		await vi.advanceTimersByTimeAsync(1000)
		tick()
		expect(hooks.refresh).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1000)
		tick()
		expect(hooks.refresh).toHaveBeenCalledTimes(2)
		page = await load()
		html = markup()
		expect(html).not.toContain('aria-current="step"')
		expect(html).not.toContain("On <span")
		if (surface === "list") expect(html).toContain("Stopped on <span")
		else {
			expect(html).toContain("Game ended")
			expect(html).toContain('aria-label="Stopped"')
			expect(html).not.toContain(">Now<")
		}
		expect(hooks.connection.start).toHaveBeenCalledOnce()
		expect(vi.getTimerCount()).toBe(0)
		unmount(state)
	},
)

it("keeps divergent preview snapshots read-only while the editor owns server synchronization", () => {
	provider()
	const editor = scope()
	const penalty = scope()
	const desktop = scope()
	const phone = scope()
	const target = { arcId: "arc", questId: "quest", field: "hints" } as const
	const stale = [{ id: "hint", text: "Hidden", points: 5 }]
	const fresh = [{ id: "hint", text: "Updated hidden", points: 12 }]
	const list = (items: typeof stale) => render(editor, () => useAutosaveList(target, items))
	const points = (value: number) =>
		render(penalty, () => useAutosaveField({ ...target, hintId: "hint", field: "points" }, value))
	list(stale)
	points(5)
	const read = (state: Scope, items: typeof stale) => render(state, () => useDraftHints(target, items))
	read(desktop, stale)
	read(phone, fresh)
	list(fresh)
	points(12)
	read(desktop, stale)
	read(phone, fresh)
	const notifications = [desktop.values[0], phone.values[0]]
	for (let sweep = 0; sweep < 6; sweep++) {
		expect(read(desktop, stale)).toEqual(fresh)
		expect(read(phone, fresh)).toEqual(fresh)
	}
	expect([desktop.values[0], phone.values[0]]).toEqual(notifications)
	expect(list(fresh).items).toEqual(fresh)
	expect(points(12).value).toBe(12)
	expect(saveSeasonField).not.toHaveBeenCalled()
	expect(patchSeasonList).not.toHaveBeenCalled()
})

it.each(["direct", "via placeholder"])(
	"keeps elapsed preview time across delayed quest navigation %s",
	async (route) => {
		provider()
		const now = Date.now()
		const quest = {
			id: "first",
			displayTitle: "First",
			content: "",
			assetPath: null,
			points: 20,
			hints: [],
			internalTitle: "",
			adminNotes: "",
			answers: [],
		}
		const next = { ...quest, id: "next", displayTitle: "Next" }
		const season = {
			start: new Date(now - 60_000),
			end: new Date(now + 60_000),
			lengthMinutes: 2,
			finishers: [],
			arcs: [{ id: "arc", title: "Arc", shuffleQuests: false, quests: [quest, next] }],
		}
		const layout = scope()
		let preview = scope()
		const frame = () => render(layout, () => SeasonPreview({ season, teams: [], now }))
		const timeLeft = () => {
			const element = frame() as ReactElement<Parameters<typeof QuestPreview>[0]>
			const result = render(preview, () => QuestPreview(element.props))
			return result.props.children[1].props.children.props.children.props.children.props.timeLeftMs
		}
		hooks.segments = ["quests", "first"]
		expect(timeLeft()).toBe(60_000)
		await vi.advanceTimersByTimeAsync(30_000)
		expect(timeLeft()).toBe(30_000)
		unmount(preview)
		if (route === "via placeholder") {
			hooks.segments = ["settings"]
			frame()
			await vi.advanceTimersByTimeAsync(10_000)
		}
		hooks.segments = ["quests", "next"]
		preview = scope()
		expect(timeLeft()).toBe(route === "direct" ? 30_000 : 20_000)
		unmount(preview)
		unmount(layout)
	},
)

it("keeps a read-only draft subscribed through save and editor unmount until refresh", async () => {
	const { context } = provider()
	const editor = scope()
	const preview = scope()
	const target = { arcId: "arc", questId: "quest", field: "content" } as const
	const read = (value = "Old") => render(preview, () => useDraftValue(target, value))
	expect(read()).toBe("Old")
	const field = render(editor, () => useAutosaveField(target, "Old"))
	const notifications = preview.values[0] as number
	field.onChange("Live draft")
	expect(preview.values[0]).toBeGreaterThan(notifications)
	expect(read()).toBe("Live draft")
	expect(saveSeasonField).not.toHaveBeenCalled()
	await field.onBlur()
	unmount(editor)
	await vi.advanceTimersByTimeAsync(0)
	expect(context.drafts.size).toBe(1)
	expect(read()).toBe("Live draft")
	const refreshedEditor = scope()
	render(refreshedEditor, () => useAutosaveField(target, "Refreshed"))
	expect(read("Refreshed")).toBe("Refreshed")
	unmount(refreshedEditor)
	unmount(preview)
	expect(context.drafts.size).toBe(0)
})

it("reads optimistic hint lists and penalties before saving and after editor unmount", async () => {
	provider()
	const editor = scope()
	const penalty = scope()
	const preview = scope()
	const target = { arcId: "arc", questId: "quest", field: "hints" } as const
	const hints = [{ id: "hint", text: "Hidden", points: 5 }]
	const read = (value = hints) => render(preview, () => useDraftHints(target, value))
	expect(read()).toEqual(hints)
	const list = render(editor, () => useAutosaveList(target, hints))
	const field = render(penalty, () => useAutosaveField({ ...target, hintId: "hint", field: "points" }, 5))
	field.onChange(12)
	expect(read()[0]?.points).toBe(12)
	void list.add({ id: "new", text: "New hidden", points: 8 })
	expect(read().map((hint) => hint.points)).toEqual([12, 8])
	await field.onBlur()
	unmount(editor)
	unmount(penalty)
	await vi.advanceTimersByTimeAsync(0)
	expect(read().map((hint) => hint.points)).toEqual([12, 8])
	const refreshed = [{ id: "hint", text: "Hidden", points: 15 }]
	render(scope(), () => useAutosaveList(target, refreshed))
	render(scope(), () => useAutosaveField({ ...target, hintId: "hint", field: "points" }, 15))
	expect(read(refreshed).map((hint) => hint.points)).toEqual([15])
})

it("shares asset action results without autosaving and accepts refreshed assets", () => {
	const { state } = provider()
	const editor = scope()
	const preview = scope()
	const target = { arcId: "arc", questId: "quest", field: "assetPath" } as const
	const read = (value: string | null = null) => render(preview, () => useDraftValue(target, value))
	expect(read()).toBeNull()
	const asset = render(editor, () => useAssetDraft(target, null))
	asset.onChange("/assets/uploaded.png")
	expect(read()).toBe("/assets/uploaded.png")
	expect(provider(state).context.status).toBeNull()
	render(editor, () => useAssetDraft(target, "/assets/replaced.pdf"))
	expect(read("/assets/replaced.pdf")).toBe("/assets/replaced.pdf")
	expect(saveSeasonField).not.toHaveBeenCalled()
})

it("registers moves with header status, holds remote order and retries online", async () => {
	const { state: providerState } = provider()
	const state = scope()
	const save = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true })
	const serverItems = ["a", "b", "c"]
	const renderMoves = (items = serverItems) =>
		render(state, () => useMoveQueue({ field: "test-order" }, items, moveFirst, save))
	let moves = renderMoves()
	moves.setDragging(true)
	renderMoves(["b", "a", "c"])
	expect(renderMoves().items).toEqual(serverItems)
	await moves.move("c")
	moves.setDragging(false)
	expect(provider(providerState).context.status).toBe("failed")
	moves = renderMoves(["a", "b", "c", "d"])
	expect(moves.items).toEqual(["c", "a", "b"])
	window.dispatchEvent(new Event("online"))
	expect(provider(providerState).context.status).toBe("saving")
	await vi.waitFor(() => expect(provider(providerState).context.status).toBe("saved"))
	expect(save.mock.calls).toEqual([["c"], ["c"]])
	expect(renderMoves(["b", "c", "a"]).failed).toBe(false)
	expect(renderMoves(["b", "c", "a"]).items).toEqual(["b", "c", "a"])
})

it("retains failed move drafts through navigation and header retry", async () => {
	const { context } = provider()
	const save = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true })
	const first = scope()
	const renderMoves = (state: Scope) =>
		render(state, () => useMoveQueue({ field: "test-order" }, ["a", "b", "c"], moveFirst, save))
	await renderMoves(first).move("c")
	unmount(first)
	const second = scope()
	expect(renderMoves(second).items).toEqual(["c", "a", "b"])
	context.retryAll()
	await vi.waitFor(() => expect(renderMoves(second).failed).toBe(false))
	unmount(second)
	expect(context.drafts.size).toBe(0)
	expect(save.mock.calls).toEqual([["c"], ["c"]])
})

it("move conflicts clear failure and refresh server data without retrying", async () => {
	const { state: providerState, context } = provider()
	const state = scope()
	const save = vi.fn().mockResolvedValue({ ok: false, conflict: true })
	const renderMoves = (items: string[]) =>
		render(state, () => useMoveQueue({ field: "test-order" }, items, moveFirst, save))
	await renderMoves(["a", "b", "c"]).move("c")
	expect(hooks.refresh).toHaveBeenCalledOnce()
	expect(provider(providerState).context.status).toBe("saved")
	expect(renderMoves(["b", "a"]).items).toEqual(["a", "b", "c"])
	expect(renderMoves(["b", "a"]).items).toEqual(["b", "a"])
	context.retryAll()
	expect(save).toHaveBeenCalledOnce()
})

beforeEach(() => {
	vi.clearAllMocks()
	vi.useFakeTimers()
	hooks.context = null
	hooks.segments = []
	vi.stubGlobal("window", new EventTarget())
	vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }))
	vi.mocked(saveSeasonField).mockReset().mockResolvedValue({ ok: true })
	vi.mocked(patchSeasonList).mockReset().mockResolvedValue({ ok: true })
	vi.mocked(removeArc).mockReset().mockResolvedValue({ ok: true })
	vi.mocked(removeQuest).mockReset().mockResolvedValue({ ok: true })
	vi.mocked(moveQuest).mockReset().mockResolvedValue({ ok: true })
})

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

it("renders nothing without a provider or registered fields, then saved, saving and failed states", () => {
	expect(renderToStaticMarkup(<SaveStatus />)).toBe("")
	const { state, context } = provider()
	expect(renderToStaticMarkup(<SaveStatus />)).toBe("")
	const retry = vi.fn()
	context.update("title", "saved", retry)
	provider(state)
	expect(renderToStaticMarkup(<SaveStatus />)).toContain('class="font-cond text-xs text-muted"')
	expect(renderToStaticMarkup(<SaveStatus />)).toContain("Saved")
	context.update("title", "pending", retry)
	provider(state)
	expect(renderToStaticMarkup(<SaveStatus />)).toContain("Saving…")
	context.update("title", "failed", retry)
	provider(state)
	const button = SaveStatus()
	expect(renderToStaticMarkup(button)).toContain('Not saved, <span class="underline">retry</span>')
	expect(renderToStaticMarkup(button)).toContain("min-h-11 px-3 font-cond text-sm text-warn")
	button?.props.onClick()
	expect(retry).toHaveBeenCalledOnce()
	context.remove("title")
	provider(state)
	expect(renderToStaticMarkup(<SaveStatus />)).toBe("")
})

it("gives failed fields precedence and colors only a failed header rule", () => {
	const { state, context } = provider()
	context.update("one", "saving", vi.fn())
	context.update("two", "failed", vi.fn())
	expect(provider(state).context.status).toBe("failed")
	expect(renderToStaticMarkup(<AutosaveHeader className="border-b">Title</AutosaveHeader>)).toContain("border-warn")
	context.remove("two")
	expect(provider(state).context.status).toBe("saving")
	const html = renderToStaticMarkup(<AutosaveHeader className="border-b">Title</AutosaveHeader>)
	expect(html).toContain("border-z1")
	expect(html).not.toContain("border-warn")
})

it("places desktop save status before logout without changing the content slots", () => {
	const { state, context } = provider()
	context.update("title", "failed", vi.fn())
	provider(state)
	const html = renderToStaticMarkup(
		<AdminFrame title="Season" menu={<nav>Menu</nav>} phoneHeader={<header>Phone</header>}>
			<p>Content</p>
		</AdminFrame>,
	)
	expect(html).toContain("lg:flex border-warn")
	expect(html.indexOf("Not saved,")).toBeLessThan(html.indexOf('action="/logout"'))
	expect(html).toContain("Content")
})

it("guards unloading only while saving or failed, retries failures online and removes listeners", () => {
	const add = vi.spyOn(window, "addEventListener")
	const remove = vi.spyOn(window, "removeEventListener")
	const { state, context } = provider()
	expect(add.mock.calls.filter(([name]) => name === "beforeunload")).toHaveLength(0)
	const retry = vi.fn()
	context.update("title", "pending", retry)
	provider(state)
	const event = new Event("beforeunload", { cancelable: true })
	window.dispatchEvent(event)
	expect(event.defaultPrevented).toBe(true)
	context.update("title", "failed", retry)
	provider(state)
	const failed = new Event("beforeunload", { cancelable: true })
	window.dispatchEvent(failed)
	expect(failed.defaultPrevented).toBe(true)
	window.dispatchEvent(new Event("online"))
	expect(retry).toHaveBeenCalledOnce()
	context.update("title", "saved", retry)
	provider(state)
	const saved = new Event("beforeunload", { cancelable: true })
	window.dispatchEvent(saved)
	expect(saved.defaultPrevented).toBe(false)
	unmount(state)
	expect(remove.mock.calls.some(([name]) => name === "online")).toBe(true)
	expect(remove.mock.calls.filter(([name]) => name === "beforeunload")).toHaveLength(2)
})

it("refreshes on season events and stops the live connection on unmount", async () => {
	const { state } = provider()
	const options = vi.mocked(createLiveConnection).mock.calls[0]?.[0]
	expect(options?.url).toBe("/api/events?channel=season%3Aseason-1")
	expect(hooks.connection.start).toHaveBeenCalledOnce()
	options?.onData(await options.fetcher())
	expect(hooks.refresh).toHaveBeenCalledOnce()
	document.dispatchEvent(new Event("visibilitychange"))
	expect(hooks.connection.setHidden).toHaveBeenCalledWith(false)
	unmount(state)
	expect(hooks.connection.stop).toHaveBeenCalledOnce()
})

it("subscribes to the open team's ordinary puzzle drops on phone and desktop, switching on navigation", async () => {
	hooks.segments = ["teams", "team-ravarna"]
	const { state } = provider()
	const options = vi.mocked(createLiveConnection).mock.calls[0]?.[0]
	expect(options?.url).toBe("/api/events?channel=season%3Aseason-1&channel=team%3Ateam-ravarna")
	options?.onData(await options.fetcher())
	expect(hooks.refresh).toHaveBeenCalledOnce()
	hooks.segments = ["teams", "team-ninjas"]
	provider(state)
	expect(hooks.connection.stop).toHaveBeenCalledOnce()
	expect(vi.mocked(createLiveConnection).mock.lastCall?.[0].url).toBe(
		"/api/events?channel=season%3Aseason-1&channel=team%3Ateam-ninjas",
	)
	hooks.segments = ["quests", "gather-the-pieces"]
	provider(state)
	expect(hooks.connection.stop).toHaveBeenCalledTimes(2)
	expect(vi.mocked(createLiveConnection).mock.lastCall?.[0].url).toBe("/api/events?channel=season%3Aseason-1")
	unmount(state)
})

it.each([
	{ rows: 8, cols: 4 },
	{ rows: 4, cols: 1 },
	{ rows: 2.5, cols: 4 },
	{ rows: 4, cols: Number.NaN },
])("skips invalid puzzle preview requests for %j and resumes after correction", async (dimensions) => {
	const state = scope()
	const quest = { id: "quest", assetPath: "/assets/chart.png", puzzle: { ...dimensions, showFull: false } }
	const preview = () => render(state, () => usePuzzlePreviewAssets(quest))
	const assets = { aspect: 2, ids: ["a", "b", "c", "d"], fullUrl: "/api/puzzle/quest/full", tileQuery: "" }
	vi.mocked(getPuzzlePreviewAssets).mockResolvedValue(assets)
	expect(preview()).toBeUndefined()
	expect(getPuzzlePreviewAssets).not.toHaveBeenCalled()
	quest.puzzle = { rows: 2, cols: 2, showFull: false }
	preview()
	await vi.advanceTimersByTimeAsync(0)
	expect(preview()).toEqual(assets)
	expect(getPuzzlePreviewAssets).toHaveBeenCalledOnce()
	quest.puzzle = { ...dimensions, showFull: false }
	expect(preview()).toBeUndefined()
	expect(getPuzzlePreviewAssets).toHaveBeenCalledOnce()
	unmount(state)
})

it("leaves the puzzle preview empty when the server rejects its assets", async () => {
	const state = scope()
	const quest = { id: "quest", assetPath: "/assets/chart.png", puzzle: { rows: 2, cols: 2, showFull: false } }
	vi.mocked(getPuzzlePreviewAssets).mockResolvedValue(null)
	const preview = () => render(state, () => usePuzzlePreviewAssets(quest))
	preview()
	await vi.advanceTimersByTimeAsync(0)
	expect(preview()).toBeUndefined()
	unmount(state)
})

it("adopts only idle unfocused field values, saves edits and flushes pending work on unmount", async () => {
	const owner = provider()
	const state = scope()
	const target = { field: "title" } as const
	const field = (value: string) => render(state, () => useAutosaveField(target, value))
	expect(field("First").value).toBe("First")
	field("Remote")
	expect(field("Remote").value).toBe("Remote")
	field("Remote").onFocus()
	field("Focused remote")
	expect(field("Focused remote").value).toBe("Remote")
	field("Focused remote").onChange("Local")
	field("Unsaved remote")
	expect(field("Unsaved remote").value).toBe("Local")
	await field("Unsaved remote").onBlur()
	expect(saveSeasonField).toHaveBeenCalledWith("season-1", target, "Local")
	field("Unsaved remote").onChange("Leaving")
	unmount(state)
	expect(saveSeasonField).toHaveBeenLastCalledWith("season-1", target, "Leaving")
	await vi.advanceTimersByTimeAsync(0)
	expect(provider(owner.state).context.status).toBe(null)
})

it("preserves failed field values and retries through the provider", async () => {
	const owner = provider()
	const state = scope()
	const field = () => render(state, () => useAutosaveField({ field: "title" }, "First"))
	vi.mocked(saveSeasonField).mockResolvedValueOnce({ ok: false, error: "Invalid value." })
	field().onChange("Local")
	await field().onBlur()
	expect(field().failed).toBe(true)
	expect(field().error).toBe("Invalid value.")
	expect(field().value).toBe("Local")
	owner.context.retryAll()
	await vi.advanceTimersByTimeAsync(0)
	expect(field().failed).toBe(false)
	expect(field().error).toBeUndefined()
	expect(field().value).toBe("Local")
	expect(saveSeasonField).toHaveBeenCalledTimes(2)
	expect(saveSeasonField).toHaveBeenLastCalledWith("season-1", { field: "title" }, "Local")
})

it("shares arc shuffle drafts and failures between desktop and phone trees until the last unmount", async () => {
	const owner = provider()
	const menu = scope()
	const page = scope()
	const target = { arcId: "arc-1", field: "shuffleQuests" } as const
	const field = (state: Scope) => render(state, () => useAutosaveField(target, false))
	field(menu)
	field(page)
	vi.mocked(saveSeasonField).mockResolvedValueOnce({ ok: false, error: "Invalid value." })
	field(menu).onChange(true)
	expect(field(page).value).toBe(true)
	await field(menu).onBlur()
	expect(field(menu).failed).toBe(true)
	expect(field(page).failed).toBe(true)
	owner.context.retryAll()
	await vi.advanceTimersByTimeAsync(0)
	unmount(page)
	expect(provider(owner.state).context.status).toBe("saved")
	field(menu).onChange(false)
	await field(menu).onBlur()
	expect(saveSeasonField).toHaveBeenLastCalledWith("season-1", target, false)
	unmount(menu)
	expect(provider(owner.state).context.status).toBe(null)
})

it.each(["menu", "page"])("protects focused shuffle in %s from the other tree subscriber", async (focusedTree) => {
	provider()
	const menu = scope()
	const page = scope()
	const target = { arcId: "arc-1", field: "shuffleQuests" } as const
	const field = (state: Scope, value: boolean) => render(state, () => useAutosaveField(target, value))
	field(menu, false)
	field(page, false)
	const focused = focusedTree === "menu" ? menu : page
	const hidden = focusedTree === "menu" ? page : menu
	field(focused, false).onFocus()
	field(hidden, true)
	expect(field(focused, true).value).toBe(false)
	expect(field(hidden, true).value).toBe(false)
	await field(focused, true).onBlur()
	expect(field(focused, true).value).toBe(true)
	expect(field(hidden, true).value).toBe(true)
	expect(saveSeasonField).not.toHaveBeenCalled()
})

it("waits for every subscriber to release focus and adopts deferred values on focused unmount", async () => {
	provider()
	const menu = scope()
	const page = scope()
	const target = { arcId: "arc-1", field: "shuffleQuests" } as const
	const field = (state: Scope, value: boolean) => render(state, () => useAutosaveField(target, value))
	field(menu, false).onFocus()
	field(page, false).onFocus()
	field(menu, true)
	field(page, true)
	await field(menu, true).onBlur()
	expect(field(menu, true).value).toBe(false)
	unmount(page)
	expect(field(menu, true).value).toBe(true)
	expect(saveSeasonField).not.toHaveBeenCalled()
})

it.each(["quest", "arc"] as const)(
	"releases failed field and list drafts after successful %s deletion",
	async (kind) => {
		const owner = provider()
		const title = scope()
		const answers = scope()
		const arcTitle = scope()
		const target = { arcId: "arc", questId: "quest", field: "displayTitle" } as const
		vi.mocked(saveSeasonField).mockResolvedValue({ ok: false, error: "Not saved" })
		vi.mocked(patchSeasonList).mockResolvedValue({ ok: false })
		const field = render(title, () => useAutosaveField(target, "First"))
		field.onChange("Local")
		await field.onBlur()
		render(answers, () => useAutosaveList({ ...target, field: "answers" }, [])).add("lamp")
		if (kind === "arc") {
			const field = render(arcTitle, () => useAutosaveField({ arcId: "arc", field: "title" }, "Arc"))
			field.onChange("Local arc")
			await field.onBlur()
		}
		await vi.advanceTimersByTimeAsync(0)
		expect(provider(owner.state).context.status).toBe("failed")
		const view = scope()
		const props = {
			seasonId: "season-1",
			seasonTitle: "Test season",
			arcTitle: "Arc",
			hintCount: 0,
			start: null,
			end: null,
			now: Date.now(),
		}
		if (kind === "quest") {
			const element = render(view, () =>
				QuestEditor({
					...props,
					arcId: "arc",
					quest: {
						id: "quest",
						displayTitle: "First",
						internalTitle: "",
						content: "",
						assetPath: null,
						answers: [],
						points: null,
						adminNotes: "",
					},
				}),
			)
			element.props.children[2].props.onConfirm()
		} else {
			const tree = {
				arcs: [
					{
						id: "arc",
						title: "Arc",
						shuffleQuests: false,
						quests: [{ id: "quest", label: null, points: null, missing: [] }],
					},
				],
			}
			const element = render(view, () => SeasonTree({ ...props, tree, variant: "menu" }))
			firstTreeArc(element)?.props.onRemove()
			render(view, () => SeasonTree({ ...props, tree, variant: "menu" })).props.children[1].props.onConfirm()
		}
		await vi.advanceTimersByTimeAsync(0)
		expect(provider(owner.state).context.status).toBe(kind === "arc" ? "saved" : null)
		unmount(title)
		unmount(answers)
		if (kind === "arc") unmount(arcTitle)
		window.dispatchEvent(new Event("online"))
		owner.context.retryAll()
		await vi.advanceTimersByTimeAsync(1000)
		expect(saveSeasonField).toHaveBeenCalledTimes(kind === "arc" ? 2 : 1)
		expect(patchSeasonList).toHaveBeenCalledOnce()
		const leaving = new Event("beforeunload", { cancelable: true })
		window.dispatchEvent(leaving)
		expect(leaving.defaultPrevented).toBe(false)
	},
)

it.each(["pending", "saving"])(
	"cancels deleted quest drafts during %s without late status or queued writes",
	async (flow) => {
		const owner = provider()
		const title = scope()
		const answers = scope()
		const target = { arcId: "arc", questId: "quest", field: "displayTitle" } as const
		let finishField: ((result: Awaited<ReturnType<typeof saveSeasonField>>) => void) | undefined
		let finishList: ((result: { ok: boolean }) => void) | undefined
		vi.mocked(saveSeasonField).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishField = resolve
				}),
		)
		vi.mocked(patchSeasonList).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishList = resolve
				}),
		)
		const field = render(title, () => useAutosaveField(target, "First"))
		field.onChange("Local")
		if (flow === "saving") void field.onBlur()
		field.onChange("Queued")
		const list = render(answers, () => useAutosaveList({ ...target, field: "answers" }, []))
		list.add("lamp")
		list.add("queued")
		owner.context.discard({ arcId: "arc", questId: "quest" })
		expect(provider(owner.state).context.status).toBe(null)
		unmount(title)
		unmount(answers)
		finishField?.({ ok: false, error: "Not saved" })
		finishList?.({ ok: true })
		await vi.advanceTimersByTimeAsync(1000)
		owner.context.retryAll()
		window.dispatchEvent(new Event("online"))
		await vi.advanceTimersByTimeAsync(0)
		expect(saveSeasonField).toHaveBeenCalledTimes(flow === "saving" ? 1 : 0)
		expect(patchSeasonList).toHaveBeenCalledOnce()
		expect(provider(owner.state).context.status).toBe(null)
		expect(owner.context.drafts.size).toBe(0)
	},
)

it.each(["retained layout", "unrelated tree refresh"])(
	"saves new quest edits before layout catches up during %s",
	async (flow) => {
		const owner = provider()
		const menu = scope()
		const title = scope()
		const arc = { id: "arc", title: "Arc", shuffleQuests: false, quests: [] }
		const tree = { arcs: [arc] }
		const props = { seasonId: "season-1", start: null, end: null, now: Date.now(), variant: "menu" as const }
		const view = (snapshot = tree) => render(menu, () => SeasonTree({ ...props, tree: snapshot }))
		vi.mocked(addQuest).mockResolvedValueOnce({ ok: true, questId: "new-quest" })
		firstTreeArc(view())?.props.onAdd()
		await vi.advanceTimersByTimeAsync(0)
		expect(hooks.push).toHaveBeenCalledWith("/admin/seasons/season-1/quests/new-quest")
		const target = { arcId: "arc", questId: "new-quest", field: "displayTitle" } as const
		const field = () => render(title, () => useAutosaveField(target, ""))
		field().onChange("New quest title")
		provider(owner.state)
		view()
		if (flow === "unrelated tree refresh") view({ arcs: [{ ...arc, title: "Remote arc title" }] })
		await field().onBlur()
		expect(saveSeasonField).toHaveBeenCalledExactlyOnceWith("season-1", target, "New quest title")
		render(menu, () =>
			SeasonTree({
				...props,
				tree: {
					arcs: [{ ...arc, quests: [{ id: "new-quest", label: "New quest title", points: null, missing: [] }] }],
				},
			}),
		)
		field().onChange("After refresh")
		provider(owner.state)
		await field().onBlur()
		expect(saveSeasonField).toHaveBeenLastCalledWith("season-1", target, "After refresh")
		expect(provider(owner.state).context.status).toBe("saved")
	},
)

it.each(["quest", "arc"] as const)("discards only removed %s drafts after an external tree refresh", async (kind) => {
	const owner = provider()
	const menu = scope()
	const props = { seasonId: "season-1", start: null, end: null, now: Date.now(), variant: "menu" as const }
	render(menu, () =>
		SeasonTree({
			...props,
			tree: {
				arcs: [
					{
						id: "arc",
						title: "Arc",
						shuffleQuests: false,
						quests: [{ id: "quest", label: "First", points: null, missing: [] }],
					},
				],
			},
		}),
	)
	const title = scope()
	const survivor = scope()
	const arcTitle = scope()
	vi.mocked(saveSeasonField).mockResolvedValue({ ok: false, error: "Not saved" })
	const removed = render(title, () =>
		useAutosaveField({ arcId: "arc", questId: "quest", field: "displayTitle" }, "First"),
	)
	removed.onChange("Deleted draft")
	await removed.onBlur()
	unmount(title)
	const retained = render(survivor, () => useAutosaveField({ field: "title" }, "Season"))
	retained.onChange("Retained draft")
	await retained.onBlur()
	const arcField = render(arcTitle, () => useAutosaveField({ arcId: "arc", field: "title" }, "Arc"))
	arcField.onChange("Arc draft")
	await arcField.onBlur()
	unmount(arcTitle)
	const tree = { arcs: kind === "quest" ? [{ id: "arc", title: "Arc", shuffleQuests: false, quests: [] }] : [] }
	render(menu, () => SeasonTree({ ...props, tree }))
	expect(owner.context.drafts.size).toBe(kind === "quest" ? 3 : 2)
	expect(provider(owner.state).context.status).toBe("failed")
	vi.mocked(saveSeasonField).mockResolvedValue({ ok: true })
	owner.context.retryAll()
	await vi.advanceTimersByTimeAsync(0)
	expect(
		vi
			.mocked(saveSeasonField)
			.mock.calls.slice(3)
			.map((call) => call[2]),
	).toEqual(kind === "quest" ? ["Retained draft", "Arc draft"] : ["Retained draft"])
	expect(provider(owner.state).context.status).toBe("saved")
	unmount(survivor)
	unmount(menu)
	expect(provider(owner.state).context.status).toBe(null)
})

it.each(["local removal", "external removal", "claim"])(
	"discards failed indexed bonus drafts after %s without retrying or reusing them",
	async (change) => {
		const owner = provider()
		const rows = scope()
		const points = scope()
		const title = scope()
		const target = { field: "finisherBonuses", index: "2" } as const
		const season = { _id: "season-1", finisherBonuses: [50, 20, 10], finishers: [] }
		const view = (snapshot: Parameters<typeof FinisherBonusRows>[0]["season"] = season) => {
			provider(owner.state, undefined, snapshot)
			return render(rows, () => FinisherBonusRows({ season: snapshot, teams: [] }))
		}
		view()
		vi.mocked(saveSeasonField).mockResolvedValue({ ok: false, error: "Not saved" })
		const field = render(points, () => useAutosaveField(target, 10))
		field.onChange(999)
		await field.onBlur()
		const retained = render(title, () => useAutosaveField({ field: "title" }, "Season"))
		retained.onChange("Retained draft")
		await retained.onBlur()
		if (change === "local removal") {
			vi.mocked(removeLastFinisherBonus).mockResolvedValueOnce({ ok: true, removedIndex: 2 })
			const lastRow = view().props.children[2][2]
			lastRow.props.children[1].props.children[1].props.onClick()
			await vi.advanceTimersByTimeAsync(0)
			expect(removeLastFinisherBonus).toHaveBeenCalledWith(season._id)
		} else {
			unmount(points)
			view({
				...season,
				finisherBonuses: change === "claim" ? season.finisherBonuses : [50, 20],
				finishers: change === "claim" ? [{ teamId: "winner", place: 3, points: 10, at: new Date() }] : [],
			})
		}
		expect([...owner.context.drafts.values()].some((draft) => draft.target.index === "2")).toBe(false)
		if (change === "local removal") {
			unmount(points)
			view({ ...season, finisherBonuses: [50, 20] })
		}
		vi.mocked(saveSeasonField).mockClear().mockResolvedValue({ ok: true })
		owner.context.retryAll()
		window.dispatchEvent(new Event("online"))
		await vi.advanceTimersByTimeAsync(1000)
		expect(saveSeasonField).toHaveBeenCalledExactlyOnceWith("season-1", { field: "title" }, "Retained draft")
		if (change !== "claim") {
			view({ ...season, finisherBonuses: [50, 20, 0] })
			const replacement = render(scope(), () => useAutosaveField(target, 0))
			expect(replacement.value).toBe(0)
			expect(replacement.failed).toBe(false)
		}
	},
)

it.each(["external removal", "claim"])(
	"discards failed bonus drafts after leaving Settings then %s before retry",
	async (change) => {
		const season: Pick<Season, "_id" | "finisherBonuses" | "finishers"> = {
			_id: "season-1",
			finisherBonuses: [50, 20, 10],
			finishers: [],
		}
		const owner = provider(undefined, undefined, season)
		const settings = scope()
		const points = scope()
		const target = { field: "finisherBonuses", index: "2" } as const
		render(settings, () => FinisherBonusRows({ season, teams: [] }))
		vi.mocked(saveSeasonField).mockResolvedValue({ ok: false, error: "Not saved" })
		const field = render(points, () => useAutosaveField(target, 10))
		field.onChange(999)
		await field.onBlur()
		unmount(points)
		unmount(settings)
		hooks.segments = ["quests", "quest"]
		const quest = render(scope(), () => useAutosaveField({ arcId: "arc", questId: "quest", field: "content" }, ""))
		quest.onChange("Retained quest draft")
		await quest.onBlur()
		provider(owner.state, undefined, {
			finisherBonuses: change === "claim" ? season.finisherBonuses : [50, 20],
			finishers: change === "claim" ? [{ teamId: "winner", place: 3, points: 10, at: new Date() }] : [],
		})
		vi.mocked(saveSeasonField).mockClear().mockResolvedValue({ ok: true })
		owner.context.retryAll()
		window.dispatchEvent(new Event("online"))
		await vi.advanceTimersByTimeAsync(1000)
		expect(saveSeasonField).toHaveBeenCalledExactlyOnceWith(
			"season-1",
			{ arcId: "arc", questId: "quest", field: "content" },
			"Retained quest draft",
		)
		expect([...owner.context.drafts.values()].some((draft) => draft.target.index === "2")).toBe(false)
		if (change === "external removal") {
			provider(owner.state, undefined, { ...season, finisherBonuses: [50, 20, 0] })
			const replacement = render(scope(), () => useAutosaveField(target, 0))
			expect(replacement.value).toBe(0)
			expect(replacement.failed).toBe(false)
		}
	},
)

it("keeps surviving bonus saver active when a concurrent append precedes stale removal", async () => {
	const season = { _id: "season-1", finisherBonuses: [50, 20], finishers: [] }
	const owner = provider(undefined, undefined, season)
	const rows = scope()
	const points = scope()
	const target = { field: "finisherBonuses", index: "1" } as const
	const field = () => render(points, () => useAutosaveField(target, 20))
	field()
	vi.mocked(removeLastFinisherBonus).mockResolvedValueOnce({ ok: true, removedIndex: 2 })
	const view = render(rows, () => FinisherBonusRows({ season, teams: [] }))
	view.props.children[2][1].props.children[1].props.children[1].props.onClick()
	await vi.advanceTimersByTimeAsync(0)
	provider(owner.state, undefined, season)
	field().onChange(30)
	await field().onBlur()
	expect(saveSeasonField).toHaveBeenCalledExactlyOnceWith("season-1", target, 30)
})

it.each(["menu", "page"] as const)(
	"shares failed tree moves mounted before effects after %s unmounts",
	async (leaving) => {
		const owner = provider()
		const menu = scope()
		const page = scope()
		const title = scope()
		const tree = {
			arcs: [
				{
					id: "arc",
					title: "Arc",
					shuffleQuests: false,
					quests: [{ id: "quest", label: "First", points: 10, missing: [] }],
				},
				{ id: "next", title: "Next arc", shuffleQuests: false, quests: [] },
			],
		}
		const props = { seasonId: "season-1", tree, start: null, end: null, now: Date.now() }
		const view = (state: Scope, variant: "menu" | "page") => render(state, () => SeasonTree({ ...props, variant }))
		render(menu, () => SeasonTree({ ...props, variant: "menu" }), false)
		render(page, () => SeasonTree({ ...props, variant: "page" }), false)
		for (const state of [menu, page]) for (const effect of state.pending.splice(0)) effect()
		const field = render(title, () => useAutosaveField({ field: "title" }, "Season"))
		field.onChange("Local season title")
		vi.mocked(moveQuest).mockResolvedValueOnce({ ok: false, error: "Not saved, retry" })
		firstTreeArc(view(menu, "menu"))?.props.onMove({ kind: "quest", id: "quest", toArcId: "next", beforeId: null })
		await vi.advanceTimersByTimeAsync(0)
		expect(provider(owner.state).context.status).toBe("failed")
		const remote = view(page, "page")
		const layer = remote.props.children[0]
		expect(layer.props.children[1].props.children[0].props.items).toEqual(["arc", "next", "quest"])
		unmount(leaving === "menu" ? menu : page)
		expect(provider(owner.state).context.status).toBe("failed")
		owner.context.retryAll()
		await vi.advanceTimersByTimeAsync(0)
		expect(moveQuest).toHaveBeenCalledTimes(2)
		expect(moveQuest).toHaveBeenLastCalledWith({ seasonId: "season-1", id: "quest", toArcId: "next", beforeId: null })
		await field.onBlur()
		expect(saveSeasonField).toHaveBeenLastCalledWith("season-1", { field: "title" }, "Local season title")
		expect(provider(owner.state).context.status).toBe("saved")
	},
)

it.each(["tree first", "editor first", "source arc removed"])(
	"keeps open quest drafts and writes to the destination after a cross-arc move, %s",
	async (flow) => {
		const owner = provider()
		const menu = scope()
		const content = scope()
		const answers = scope()
		const hints = scope()
		const hintText = scope()
		const quest = { id: "quest", label: "Quest", points: 10, missing: [] }
		const source = { id: "arc", title: "Arc", shuffleQuests: false, quests: [quest] }
		const destination = { id: "next", title: "Next", shuffleQuests: false, quests: [] as (typeof quest)[] }
		const props = { seasonId: "season-1", start: null, end: null, now: Date.now(), variant: "menu" as const }
		const view = (arcs = [source, destination]) => render(menu, () => SeasonTree({ ...props, tree: { arcs } }))
		let arcId = "arc"
		const field = () => render(content, () => useAutosaveField({ arcId, questId: "quest", field: "content" }, "First"))
		const answerList = () => render(answers, () => useAutosaveList({ arcId, questId: "quest", field: "answers" }, []))
		const hintList = () => render(hints, () => useAutosaveList({ arcId, questId: "quest", field: "hints" }, []))
		const hintField = () =>
			render(hintText, () => useAutosaveField({ arcId, questId: "quest", hintId: "hint", field: "text" }, "Hint"))
		view()
		field().onChange("Unsaved content")
		vi.mocked(patchSeasonList).mockResolvedValue({ ok: false })
		void answerList().add("unsaved answer")
		void hintList().add({ id: "hint", text: "Unsaved hint", points: 5 })
		hintField().onChange("Unsaved hint edit")
		await vi.advanceTimersByTimeAsync(0)
		firstTreeArc(view())?.props.onMove({ kind: "quest", id: "quest", toArcId: "next", beforeId: null })
		await vi.advanceTimersByTimeAsync(0)
		arcId = "next"
		const moved = [
			{ ...source, quests: [] },
			{ ...destination, quests: [quest] },
		]
		if (flow === "editor first") {
			field()
			answerList()
			hintList()
			hintField()
		}
		view(flow === "source arc removed" ? moved.slice(1) : moved)
		expect(field().value).toBe("Unsaved content")
		expect(answerList().items).toEqual(["unsaved answer"])
		expect(hintList().items).toEqual([{ id: "hint", text: "Unsaved hint edit", points: 5 }])
		expect(hintField().value).toBe("Unsaved hint edit")
		vi.mocked(patchSeasonList).mockResolvedValue({ ok: true })
		owner.context.retryAll()
		await field().onBlur()
		await hintField().onBlur()
		expect(saveSeasonField).toHaveBeenCalledWith(
			"season-1",
			{ arcId: "next", questId: "quest", field: "content" },
			"Unsaved content",
		)
		expect(saveSeasonField).toHaveBeenCalledWith(
			"season-1",
			{ arcId: "next", questId: "quest", hintId: "hint", field: "text" },
			"Unsaved hint edit",
		)
		expect(patchSeasonList).toHaveBeenCalledWith(
			"season-1",
			{ arcId: "next", questId: "quest", field: "answers" },
			{ op: "add", value: "unsaved answer" },
		)
		expect(patchSeasonList).toHaveBeenCalledWith(
			"season-1",
			{ arcId: "next", questId: "quest", field: "hints" },
			{ op: "add", hint: { id: "hint", text: "Unsaved hint edit", points: 5 } },
		)
		field().onChange("After move")
		await field().onBlur()
		await answerList().add("after move")
		await hintList().add({ id: "after", text: "After move", points: 10 })
		hintField().onChange("Hint after move")
		await hintField().onBlur()
		expect(saveSeasonField).toHaveBeenLastCalledWith(
			"season-1",
			{ arcId: "next", questId: "quest", hintId: "hint", field: "text" },
			"Hint after move",
		)
		expect(patchSeasonList).toHaveBeenLastCalledWith(
			"season-1",
			{ arcId: "next", questId: "quest", field: "hints" },
			{ op: "add", hint: { id: "after", text: "After move", points: 10 } },
		)
		expect(provider(owner.state).context.status).toBe("saved")
	},
)

it.each(["failed before navigation", "failed unmount flush"])(
	"retains field edits after %s and remount",
	async (failure) => {
		const owner = provider()
		let state = scope()
		const field = () => render(state, () => useAutosaveField({ field: "title" }, "First"))
		vi.mocked(saveSeasonField).mockResolvedValue({ ok: false, error: "Invalid value." })
		field().onChange("Local")
		if (failure === "failed before navigation") await field().onBlur()
		unmount(state)
		await vi.advanceTimersByTimeAsync(0)
		expect(provider(owner.state).context.status).toBe("failed")
		const leaving = new Event("beforeunload", { cancelable: true })
		window.dispatchEvent(leaving)
		expect(leaving.defaultPrevented).toBe(true)
		state = scope()
		expect(field().value).toBe("Local")
		expect(field().failed).toBe(true)
		field().onChange("Latest local")
		await field().onBlur()
		unmount(state)
		vi.mocked(saveSeasonField).mockResolvedValue({ ok: true })
		window.dispatchEvent(new Event("online"))
		await vi.advanceTimersByTimeAsync(0)
		expect(saveSeasonField).toHaveBeenLastCalledWith("season-1", { field: "title" }, "Latest local")
		expect(provider(owner.state).context.status).toBe(null)
		const saved = new Event("beforeunload", { cancelable: true })
		window.dispatchEvent(saved)
		expect(saved.defaultPrevented).toBe(false)
	},
)

it("adopts the latest remote field value after focus ends without an edit", async () => {
	provider()
	const state = scope()
	const field = (value: string) => render(state, () => useAutosaveField({ field: "title" }, value))
	field("First").onFocus()
	field("Remote")
	expect(field("Latest remote").value).toBe("First")
	await field("Latest remote").onBlur()
	field("Latest remote")
	expect(field("Latest remote").value).toBe("Latest remote")
	expect(saveSeasonField).not.toHaveBeenCalled()
})

it("adopts deferred remote field values when an unfocused field becomes saved", () => {
	provider()
	const state = scope()
	const field = (value: string) => render(state, () => useAutosaveField({ field: "title" }, value))
	field("First").onChange("Local")
	field("Remote")
	expect(field("Remote").value).toBe("Local")
	field("Remote").onChange("First")
	field("Remote")
	expect(field("Remote").value).toBe("Remote")
})

it.each(["pending blur", "idle save", "failed retry"])(
	"keeps local field writes over remote refreshes during %s",
	async (flow) => {
		const owner = provider()
		const state = scope()
		const target = { field: "title" } as const
		const field = (value: string) => render(state, () => useAutosaveField(target, value))
		if (flow !== "idle save") field("First").onFocus()
		field("First").onChange("Local")
		if (flow === "failed retry") {
			vi.mocked(saveSeasonField).mockResolvedValueOnce({ ok: false, error: "Invalid value." })
			await field("First").onBlur()
			expect(field("First").failed).toBe(true)
		}
		let finish: ((result: Awaited<ReturnType<typeof saveSeasonField>>) => void) | undefined
		vi.mocked(saveSeasonField).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		)
		field("Remote")
		expect(field("Remote").value).toBe("Local")
		if (flow === "failed retry") owner.context.retryAll()
		else if (flow === "idle save") await vi.advanceTimersByTimeAsync(500)
		else void field("Remote").onBlur()
		field("Latest remote")
		expect(field("Latest remote").value).toBe("Local")
		finish?.({ ok: true })
		await vi.advanceTimersByTimeAsync(0)
		field("Latest remote")
		expect(field("Latest remote").value).toBe("Local")
		expect(provider(owner.state).context.status).toBe("saved")
		field("Latest remote").onChange("Local")
		await field("Latest remote").onBlur()
		expect(saveSeasonField).toHaveBeenCalledTimes(flow === "failed retry" ? 2 : 1)
		expect(saveSeasonField).toHaveBeenLastCalledWith("season-1", target, "Local")
		field("After save")
		expect(field("After save").value).toBe("After save")
	},
)

it("reattaches a field during an unmount flush without starting a second saver", async () => {
	const owner = provider()
	let state = scope()
	const field = () => render(state, () => useAutosaveField({ field: "title" }, "First"))
	let finish: ((result: Awaited<ReturnType<typeof saveSeasonField>>) => void) | undefined
	vi.mocked(saveSeasonField).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve
			}),
	)
	field().onChange("Local")
	unmount(state)
	state = scope()
	expect(field().value).toBe("Local")
	finish?.({ ok: false, error: "Invalid value." })
	await vi.advanceTimersByTimeAsync(0)
	expect(field().failed).toBe(true)
	owner.context.retryAll()
	await vi.advanceTimersByTimeAsync(0)
	expect(field().value).toBe("Local")
	expect(field().failed).toBe(false)
	expect(provider(owner.state).context.status).toBe("saved")
	expect(saveSeasonField).toHaveBeenCalledTimes(2)
	unmount(state)
	expect(provider(owner.state).context.status).toBe(null)
})

it("retains drafts by target rather than component identity or target property order", async () => {
	const owner = provider()
	const state = scope()
	const target = { arcId: "arc", field: "title" } as const
	const field = () => render(state, () => useAutosaveField(target, "Arc"))
	vi.mocked(saveSeasonField).mockResolvedValue({ ok: false, error: "Invalid value." })
	field().onChange("Local arc")
	await field().onBlur()
	unmount(state)
	const other = scope()
	expect(render(other, () => useAutosaveField({ field: "title" }, "Season")).value).toBe("Season")
	const remount = scope()
	const retained = render(remount, () => useAutosaveField({ field: "title", arcId: "arc" }, "Arc"))
	expect(retained.value).toBe("Local arc")
	expect(retained.failed).toBe(true)
	expect(provider(owner.state).context.status).toBe("failed")
})

it.each(["failed before navigation", "failed after navigation"])(
	"retains list operations after %s and remount",
	async (failure) => {
		const owner = provider()
		let state = scope()
		const target = { arcId: "arc", questId: "quest", field: "answers" } as const
		const items = ["old"]
		const list = () => render(state, () => useAutosaveList(target, items))
		vi.mocked(patchSeasonList).mockResolvedValue({ ok: false })
		list().add("lamp")
		list().remove("old")
		if (failure === "failed before navigation") await vi.advanceTimersByTimeAsync(0)
		unmount(state)
		await vi.advanceTimersByTimeAsync(0)
		expect(provider(owner.state).context.status).toBe("failed")
		const leaving = new Event("beforeunload", { cancelable: true })
		window.dispatchEvent(leaving)
		expect(leaving.defaultPrevented).toBe(true)
		state = scope()
		expect(list().items).toEqual(["lamp"])
		expect(list().failed).toBe(true)
		list().add("keeper")
		unmount(state)
		vi.mocked(patchSeasonList).mockResolvedValue({ ok: true })
		owner.context.retryAll()
		await vi.advanceTimersByTimeAsync(0)
		expect(vi.mocked(patchSeasonList).mock.calls.map((call) => call[2])).toEqual([
			{ op: "add", value: "lamp" },
			{ op: "add", value: "lamp" },
			{ op: "remove", value: "old" },
			{ op: "add", value: "keeper" },
		])
		expect(provider(owner.state).context.status).toBe(null)
		const saved = new Event("beforeunload", { cancelable: true })
		window.dispatchEvent(saved)
		expect(saved.defaultPrevented).toBe(false)
	},
)

it("keeps successful list patches alongside a failed operation when remounted with stale server items", async () => {
	provider()
	let state = scope()
	const target = { arcId: "arc", questId: "quest", field: "answers" } as const
	const list = () => render(state, () => useAutosaveList(target, ["old"]))
	vi.mocked(patchSeasonList).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false })
	list().add("lamp")
	list().remove("old")
	await vi.advanceTimersByTimeAsync(0)
	unmount(state)
	state = scope()
	list()
	expect(list().items).toEqual(["lamp"])
	expect(list().failed).toBe(true)
})

it.each([
	["add", "saving"],
	["remove", "saving"],
	["add", "failed retry"],
	["remove", "failed retry"],
] as const)("rebases remote list refreshes through local %s during %s", async (operation, flow) => {
	const owner = provider()
	const state = scope()
	const target = { arcId: "arc", questId: "quest", field: "answers" } as const
	const list = (items: string[]) => render(state, () => useAutosaveList(target, items))
	if (flow === "failed retry") vi.mocked(patchSeasonList).mockResolvedValueOnce({ ok: false })
	let finish: ((result: { ok: boolean }) => void) | undefined
	vi.mocked(patchSeasonList).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve
			}),
	)
	if (operation === "add") list(["old"]).add("local")
	else list(["old"]).remove("old")
	if (flow === "failed retry") {
		await vi.advanceTimersByTimeAsync(0)
		expect(list(["old"]).failed).toBe(true)
	}
	const remote = ["old", "remote"]
	const expected = operation === "add" ? ["old", "remote", "local"] : ["remote"]
	list(remote)
	expect(list(remote).items).toEqual(expected)
	if (flow === "failed retry") owner.context.retryAll()
	finish?.({ ok: true })
	await vi.advanceTimersByTimeAsync(0)
	list(remote)
	expect(list([...remote]).items).toEqual(expected)
	expect(list(remote).failed).toBe(false)
	expect(provider(owner.state).context.status).toBe("saved")
	expect(patchSeasonList).toHaveBeenCalledTimes(flow === "failed retry" ? 2 : 1)
	expect(patchSeasonList).toHaveBeenLastCalledWith("season-1", target, {
		op: operation,
		value: operation === "add" ? "local" : "old",
	})
	list(["after"])
	expect(list(["after"]).items).toEqual(["after"])
})

it("keeps optimistic list edits on failure and sends one-item answer patches in order", async () => {
	const owner = provider()
	const state = scope()
	const target = { arcId: "arc", questId: "quest", field: "answers" } as const
	const items = ["old"]
	const list = () => render(state, () => useAutosaveList(target, items))
	vi.mocked(patchSeasonList).mockResolvedValueOnce({ ok: false })
	list().add("lamp")
	list().remove("old")
	await vi.advanceTimersByTimeAsync(0)
	expect(list().items).toEqual(["lamp"])
	expect(list().failed).toBe(true)
	owner.context.retryAll()
	await vi.advanceTimersByTimeAsync(0)
	expect(list().items).toEqual(["lamp"])
	expect(list().failed).toBe(false)
	expect(vi.mocked(patchSeasonList).mock.calls.map((call) => call[2])).toEqual([
		{ op: "add", value: "lamp" },
		{ op: "add", value: "lamp" },
		{ op: "remove", value: "old" },
	])
})

it("assigns a stable hint id before patching and removes hints by id", async () => {
	provider()
	const state = scope()
	const target = { arcId: "arc", questId: "quest", field: "hints" } as const
	const items = [{ id: "old", text: "Old", points: 5 }]
	const list = () => render(state, () => useAutosaveList(target, items))
	list().add({ text: "New", points: 10 })
	const hint = list().items[1]
	expect(hint?.id).toBeTypeOf("string")
	list().remove("old")
	await vi.advanceTimersByTimeAsync(0)
	expect(list().items).toEqual([hint])
	expect(patchSeasonList).toHaveBeenNthCalledWith(1, "season-1", target, { op: "add", hint })
	expect(patchSeasonList).toHaveBeenNthCalledWith(2, "season-1", target, { op: "remove", hintId: "old" })
})

it("discards removed hint fields without cancelling quest fields or its list remove patch", async () => {
	const owner = provider()
	const hint = scope()
	const quest = scope()
	const listState = scope()
	const hintField = render(hint, () =>
		useAutosaveField({ arcId: "arc", questId: "quest", hintId: "h1", field: "text" }, "Hint"),
	)
	const questField = render(quest, () => useAutosaveField({ arcId: "arc", questId: "quest", field: "points" }, 30))
	hintField.onChange("Deleted edit")
	questField.onChange(40)
	const list = render(listState, () =>
		useAutosaveList({ arcId: "arc", questId: "quest", field: "hints" }, [{ id: "h1", text: "Hint", points: 5 }]),
	)
	owner.context.discard({ arcId: "arc", questId: "quest", hintId: "h1" })
	list.remove("h1")
	unmount(hint)
	await vi.advanceTimersByTimeAsync(500)
	expect(saveSeasonField).toHaveBeenCalledExactlyOnceWith(
		"season-1",
		{ arcId: "arc", questId: "quest", field: "points" },
		40,
	)
	expect(patchSeasonList).toHaveBeenCalledExactlyOnceWith(
		"season-1",
		{ arcId: "arc", questId: "quest", field: "hints" },
		{ op: "remove", hintId: "h1" },
	)
})
