import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { patchSeasonList, saveSeasonField } from "@/app/admin/autosave-actions"
import { createLiveConnection } from "@/lib/events/live-connection"
import { AdminFrame } from "./admin-frame"
import { AutosaveProvider, useAutosaveField, useAutosaveList } from "./autosave-provider"
import { AutosaveHeader, SaveStatus } from "./save-status"

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
	connection: { start: vi.fn(), stop: vi.fn(), setHidden: vi.fn() },
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: hooks.refresh }) }))
vi.mock("@/app/admin/autosave-actions", () => ({ saveSeasonField: vi.fn(), patchSeasonList: vi.fn() }))
vi.mock("@/lib/events/live-connection", () => ({ createLiveConnection: vi.fn(() => hooks.connection) }))

function scope(): Scope {
	return { values: [], cursor: 0, effects: new Map(), pending: [] }
}

function render<T>(state: Scope, run: () => T): T {
	hooks.active = state
	state.cursor = 0
	const result = run()
	for (const effect of state.pending.splice(0)) effect()
	return result
}

function unmount(state: Scope) {
	for (const effect of state.effects.values()) effect.cleanup?.()
}

function provider(state = scope()) {
	const element = render(state, () => AutosaveProvider({ seasonId: "season-1", children: null }))
	hooks.context = element.props.value
	return { state, context: element.props.value }
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.useFakeTimers()
	hooks.context = null
	vi.stubGlobal("window", new EventTarget())
	vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }))
	vi.mocked(saveSeasonField).mockResolvedValue({ ok: true })
	vi.mocked(patchSeasonList).mockResolvedValue({ ok: true })
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
	vi.mocked(saveSeasonField).mockResolvedValueOnce({ ok: false })
	field().onChange("Local")
	await field().onBlur()
	expect(field().failed).toBe(true)
	expect(field().value).toBe("Local")
	owner.context.retryAll()
	await vi.advanceTimersByTimeAsync(0)
	expect(field().failed).toBe(false)
	expect(saveSeasonField).toHaveBeenCalledTimes(2)
	expect(saveSeasonField).toHaveBeenLastCalledWith("season-1", { field: "title" }, "Local")
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
