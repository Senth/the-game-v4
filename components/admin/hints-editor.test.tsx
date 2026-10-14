import { Children, cloneElement, type EffectCallback, isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { patchSeasonList, saveSeasonField } from "@/app/admin/autosave-actions"
import { hintRevealers } from "@/lib/domain/hints"
import { AutosavePointsField } from "./autosave-points-field"
import { AutosaveProvider } from "./autosave-provider"
import { HintsEditor } from "./hints-editor"

type Scope = {
	values: unknown[]
	cursor: number
	effects: Map<number, { deps: unknown[]; cleanup?: () => void; setup: EffectCallback }>
	pending: (() => void)[]
}
const hooks = vi.hoisted(() => ({
	active: null as unknown as Scope,
	context: null as unknown,
	focus: vi.fn(),
	showModal: vi.fn(),
	close: vi.fn(),
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
		scope.values[index] ??= {
			current: initial === null ? { focus: hooks.focus, showModal: hooks.showModal, close: hooks.close } : initial,
		}
		return scope.values[index]
	},
	useId: () => "hint-field",
	useContext: () => hooks.context,
	useEffectEvent: (callback: () => void) => callback,
	useCallback: (callback: unknown, deps: unknown[]) => {
		const scope = hooks.active
		const index = scope.cursor++
		const previous = scope.values[index] as { callback: unknown; deps: unknown[] } | undefined
		if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) scope.values[index] = { callback, deps }
		return (scope.values[index] as { callback: unknown }).callback
	},
	useEffect: (effect: EffectCallback, deps: unknown[]) => {
		const scope = hooks.active
		const index = scope.cursor++
		const previous = scope.effects.get(index)
		if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return
		scope.pending.push(() => {
			previous?.cleanup?.()
			const cleanup = effect()
			scope.effects.set(index, { deps, cleanup: cleanup || undefined, setup: effect })
		})
	},
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/app/admin/autosave-actions", () => ({ saveSeasonField: vi.fn(), patchSeasonList: vi.fn() }))
vi.mock("react-dom", () => ({ createPortal: (node: ReactNode) => node }))
vi.mock("@/lib/events/live-connection", () => ({
	createLiveConnection: () => ({ start() {}, stop() {}, setHidden() {} }),
}))

function scope(): Scope {
	return { values: [], cursor: 0, effects: new Map(), pending: [] }
}
function run<T>(state: Scope, callback: () => T): T {
	hooks.active = state
	state.cursor = 0
	const result = callback()
	for (const effect of state.pending.splice(0)) effect()
	return result
}

const props = {
	arcId: "arc",
	questId: "quest",
	points: 30 as number | null,
	hints: [
		{ id: "h1", text: "Start from the bottom.", points: 5 },
		{ id: "h2", text: "Read the last letters.", points: 10 },
	],
	revealers: {} as Record<string, string[]>,
	hasStarted: false,
}
let editor: Scope
let rows: Map<string, Scope>
let questPoints: Scope
let dialog: Scope

type NodeProps = {
	children?: ReactNode
	className?: string
	value?: string | number
	onClick?: () => void
	onClose?: () => void
	onBlur?: () => void
	onChange?: (event: { target: { value: string; valueAsNumber: number } }) => void
	onKeyDown?: (event: { key: string; preventDefault: () => void; nativeEvent: { isComposing: boolean } }) => void
}
function nodes(node: ReactNode, type: string): ReactElement<NodeProps>[] {
	return Children.toArray(node).flatMap((child) => {
		if (!isValidElement<NodeProps>(child)) return []
		return [...(child.type === type ? [child] : []), ...nodes(child.props.children, type)]
	})
}
function view(snapshot = props) {
	let section = run(editor, () => HintsEditor(snapshot))
	const list = section.props.children[1]
	const rowElements = Children.toArray(list.props.children).filter(isValidElement)
	const activeIds = new Set(rowElements.map((row) => String(row.key)))
	for (const [id, state] of rows) {
		if (activeIds.has(id)) continue
		for (const effect of state.effects.values()) effect.cleanup?.()
		rows.delete(id)
	}
	const renderedRows = rowElements.map((row: ReactElement) => {
		const id = String(row.key)
		if (!rows.has(id)) rows.set(id, scope())
		const rendered = run(rows.get(id) as Scope, () => (row.type as (props: unknown) => ReactElement)(row.props))
		return cloneElement(rendered, { key: id })
	})
	section = run(editor, () => HintsEditor(snapshot))
	const children = [...section.props.children]
	children[1] = cloneElement(list, {}, renderedRows)
	const dialogIndex = children.findIndex(
		(child) => isValidElement(child) && typeof child.type === "function" && child.type.name === "ConfirmDialog",
	)
	if (dialogIndex >= 0) {
		const element = children[dialogIndex]
		children[dialogIndex] = run(dialog, () => element.type(element.props))
	}
	const tree = cloneElement(section, {}, ...children)
	return {
		tree,
		html: renderToStaticMarkup(tree),
		buttons: nodes(tree, "button"),
		textareas: nodes(tree, "textarea"),
		inputs: nodes(tree, "input"),
		editing: nodes(tree, "form").find((node) => node.props.onKeyDown),
	}
}
function key(key: string) {
	return { key, preventDefault: vi.fn(), nativeEvent: { isComposing: false } }
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.useFakeTimers()
	vi.stubGlobal("window", new EventTarget())
	vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }))
	vi.mocked(saveSeasonField).mockReset().mockResolvedValue({ ok: true })
	vi.mocked(patchSeasonList).mockReset().mockResolvedValue({ ok: true })
	hooks.context = run(scope(), () => AutosaveProvider({ seasonId: "season", children: null })).props.value
	editor = scope()
	rows = new Map()
	questPoints = scope()
	dialog = scope()
})
afterEach(() => {
	for (const state of [editor, ...rows.values(), questPoints, dialog]) {
		for (const effect of state.effects.values()) effect.cleanup?.()
	}
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

it("rests as focusable 44 px text rows with muted penalties, no inputs and immediate Worth", () => {
	const resting = view()
	expect(resting.inputs).toHaveLength(0)
	expect(resting.textareas).toHaveLength(0)
	expect(resting.html).toContain("Worth with all hints:")
	expect(resting.html).toContain("15p")
	expect(resting.html).toContain("−5p")
	expect(resting.html).toContain("font-cond text-sm text-muted tabular-nums")
	for (const button of resting.buttons) {
		expect(button.props.className).toContain("min-h-11")
		expect(button.props.className).toContain("focus-visible:outline-accent")
	}
})

it("opens only one row, focuses textarea and flushes previous row when another opens", () => {
	view().buttons[0]?.props.onClick?.()
	const first = view()
	expect(first.textareas).toHaveLength(1)
	expect(first.textareas[0]?.props.value).toBe(props.hints[0]?.text)
	expect(hooks.focus).toHaveBeenCalledOnce()
	first.textareas[0]?.props.onChange?.({ target: { value: "Typed first", valueAsNumber: Number.NaN } })
	first.buttons
		.find((button) => nodes(button, "span").some((span) => span.props.children === props.hints[1]?.text))
		?.props.onClick?.()
	const second = view()
	expect(second.textareas).toHaveLength(1)
	expect(second.textareas[0]?.props.value).toBe(props.hints[1]?.text)
	expect(saveSeasonField).toHaveBeenCalledWith(
		"season",
		{ arcId: "arc", questId: "quest", hintId: "h1", field: "text" },
		"Typed first",
	)
})

it.each(["Enter", "Escape", "Done"])(
	"%s collapses without discarding typed text or cancelling autosave",
	async (close) => {
		view().buttons[0]?.props.onClick?.()
		let opened = view()
		opened.textareas[0]?.props.onChange?.({ target: { value: "Keep this edit", valueAsNumber: Number.NaN } })
		opened = view()
		const event = key(close)
		if (close === "Done") opened.buttons.find((button) => button.props.children === "Done")?.props.onClick?.()
		else opened.editing?.props.onKeyDown?.(event)
		const closed = view()
		expect(closed.textareas).toHaveLength(0)
		expect(closed.html).toContain("Keep this edit")
		if (close !== "Done") expect(event.preventDefault).toHaveBeenCalledOnce()
		await vi.advanceTimersByTimeAsync(500)
		expect(saveSeasonField).toHaveBeenCalledExactlyOnceWith(
			"season",
			{ arcId: "arc", questId: "quest", hintId: "h1", field: "text" },
			"Keep this edit",
		)
		closed.buttons[0]?.props.onClick?.()
		expect(view().textareas[0]?.props.value).toBe("Keep this edit")
	},
)

it("updates Worth before penalty save resolves and shares unsaved quest Points", async () => {
	let finish!: (result: { ok: true }) => void
	vi.mocked(saveSeasonField).mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve
			}),
	)
	view().buttons[1]?.props.onClick?.()
	view().inputs[0]?.props.onChange?.({ target: { value: "15", valueAsNumber: 15 } })
	expect(view().html).toContain("10p")
	await vi.advanceTimersByTimeAsync(500)
	expect(saveSeasonField).toHaveBeenCalledWith(
		"season",
		{ arcId: "arc", questId: "quest", hintId: "h2", field: "points" },
		15,
	)
	expect(view().html).toContain("10p")
	finish({ ok: true })
	await vi.advanceTimersByTimeAsync(0)
	const input = run(questPoints, () => AutosavePointsField({ arcId: "arc", questId: "quest", serverValue: 30 }))
	input.props.onChange({ target: { value: "40", valueAsNumber: 40 } })
	expect(view().html).toContain("20p")
})

it("shows missing and negative Worth, preserves long one-line text and keeps penalty from shrinking", () => {
	expect(view({ ...props, points: null }).html).toContain("–")
	editor = scope()
	rows.clear()
	hooks.context = run(scope(), () => AutosaveProvider({ seasonId: "other", children: null })).props.value
	const long = view({
		...props,
		points: 5,
		hints: props.hints.map((hint, index) => (index === 0 ? { ...hint, text: "Long hint ".repeat(80) } : hint)),
	})
	expect(long.html).toContain("−10p")
	expect(long.html).toContain("min-w-0 flex-1 truncate")
	expect(long.html).toContain("shrink-0 font-cond")
	expect(long.html).toContain("Long hint ".repeat(80))
})

it("shows Empty hint after clearing and server penalty error in a warn line", async () => {
	view().buttons[0]?.props.onClick?.()
	const opened = view()
	opened.textareas[0]?.props.onChange?.({ target: { value: "", valueAsNumber: Number.NaN } })
	vi.mocked(saveSeasonField).mockResolvedValue({ ok: false, error: "Use a whole number from 0 to 10000." })
	opened.inputs[0]?.props.onChange?.({ target: { value: "1.5", valueAsNumber: 1.5 } })
	await vi.advanceTimersByTimeAsync(500)
	const failed = view()
	expect(failed.html).toContain("Use a whole number from 0 to 10000.")
	expect(failed.html).toContain("border-warn")
	expect(failed.html).toContain('aria-invalid="true"')
	expect(failed.html).toContain('role="alert"')
	expect(failed.inputs[0]?.props.value).toBe(1.5)
	failed.buttons.find((button) => button.props.children === "Done")?.props.onClick?.()
	expect(view().html).toContain("Empty hint")
})

it("keeps composition and ordinary keys in edit mode, closes Enter from any control", () => {
	view().buttons[0]?.props.onClick?.()
	const composing = { ...key("Enter"), nativeEvent: { isComposing: true } }
	view().editing?.props.onKeyDown?.(composing)
	expect(composing.preventDefault).not.toHaveBeenCalled()
	const ordinary = key("a")
	view().editing?.props.onKeyDown?.(ordinary)
	expect(ordinary.preventDefault).not.toHaveBeenCalled()
	expect(view().textareas).toHaveLength(1)
	view().editing?.props.onKeyDown?.(key("Enter"))
	expect(view().textareas).toHaveLength(0)
})

it("adopts remote hint edits at rest and updates Worth without saving whole lists", () => {
	view()
	const remote = {
		...props,
		hints: props.hints.map((hint) => (hint.id === "h1" ? { ...hint, text: "Remote wording", points: 15 } : hint)),
	}
	view(remote)
	view(remote)
	const refreshed = view(remote)
	expect(refreshed.html).toContain("Remote wording")
	expect(refreshed.html).toContain(">5p</b>")
	expect(saveSeasonField).not.toHaveBeenCalled()
})

it("keeps empty penalty input and shows muted Worth rather than NaN while server rejects it", async () => {
	view().buttons[0]?.props.onClick?.()
	vi.mocked(saveSeasonField).mockResolvedValue({ ok: false, error: "Use a whole number from 0 to 10000." })
	view().inputs[0]?.props.onChange?.({ target: { value: "", valueAsNumber: Number.NaN } })
	const empty = view()
	expect(empty.inputs[0]?.props.value).toBe("")
	expect(empty.html).toContain("–")
	expect(empty.html).not.toContain("NaN")
	await vi.advanceTimersByTimeAsync(500)
	expect(view().html).toContain("Use a whole number from 0 to 10000.")
})

function add(snapshot = props) {
	view(snapshot)
		.buttons.find((button) => button.props.children === "+ Add hint")
		?.props.onClick?.()
	return view(snapshot)
}
function remove(snapshot = props) {
	view(snapshot).buttons[0]?.props.onClick?.()
	view(snapshot)
		.buttons.find((button) => button.props.children === "Remove")
		?.props.onClick?.()
	return view(snapshot)
}

it("adds a focused local row, then saves exactly one client-id hint with 5 points after idle", async () => {
	const opened = add()
	expect(opened.textareas).toHaveLength(1)
	expect(opened.inputs[0]?.props.value).toBe(5)
	expect(hooks.focus).toHaveBeenCalled()
	expect(patchSeasonList).not.toHaveBeenCalled()
	opened.textareas[0]?.props.onChange?.({ target: { value: "Look up", valueAsNumber: Number.NaN } })
	view()
	await vi.advanceTimersByTimeAsync(499)
	expect(patchSeasonList).not.toHaveBeenCalled()
	await vi.advanceTimersByTimeAsync(1)
	expect(patchSeasonList).toHaveBeenCalledExactlyOnceWith(
		"season",
		{ arcId: "arc", questId: "quest", field: "hints" },
		{ op: "add", hint: { id: expect.any(String), text: "Look up", points: 5 } },
	)
	expect(view().html).toContain(">10p</b>")
	expect(saveSeasonField).not.toHaveBeenCalled()
})

it.each(["Escape", "Enter", "Done"])("discards empty new hint on %s without any patch", async (close) => {
	const opened = add()
	if (close === "Done") opened.buttons.find((button) => button.props.children === "Done")?.props.onClick?.()
	else opened.editing?.props.onKeyDown?.(key(close))
	expect(view().textareas).toHaveLength(0)
	await vi.advanceTimersByTimeAsync(1000)
	expect(patchSeasonList).not.toHaveBeenCalled()
	expect(saveSeasonField).not.toHaveBeenCalled()
})

it("saves on blur and buffers later edits until add finishes, then uses same per-hint id", async () => {
	let finish!: (result: { ok: boolean }) => void
	vi.mocked(patchSeasonList).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve
			}),
	)
	add().textareas[0]?.props.onChange?.({ target: { value: "Look up", valueAsNumber: Number.NaN } })
	view().textareas[0]?.props.onBlur?.()
	expect(patchSeasonList).toHaveBeenCalledOnce()
	view().textareas[0]?.props.onChange?.({ target: { value: "Look higher", valueAsNumber: Number.NaN } })
	view().inputs[0]?.props.onChange?.({ target: { value: "10", valueAsNumber: 10 } })
	view()
	await vi.advanceTimersByTimeAsync(1000)
	expect(saveSeasonField).not.toHaveBeenCalled()
	finish({ ok: true })
	await vi.advanceTimersByTimeAsync(500)
	const operation = vi.mocked(patchSeasonList).mock.calls[0]?.[2]
	if (!operation || !("hint" in operation)) throw new Error("Missing add patch")
	expect(saveSeasonField).toHaveBeenCalledWith(
		"season",
		{ arcId: "arc", questId: "quest", hintId: operation.hint.id, field: "text" },
		"Look higher",
	)
	expect(saveSeasonField).toHaveBeenCalledWith(
		"season",
		{ arcId: "arc", questId: "quest", hintId: operation.hint.id, field: "points" },
		10,
	)
	expect(view().textareas[0]?.props.value).toBe("Look higher")
})

it("removes unrevealed hint with one patch, no dialog and restored Worth", async () => {
	const removed = remove()
	expect(removed.html).not.toContain("<dialog")
	expect(removed.html).not.toContain("Start from the bottom.")
	expect(removed.html).toContain(">20p</b>")
	expect(patchSeasonList).toHaveBeenCalledExactlyOnceWith(
		"season",
		{ arcId: "arc", questId: "quest", field: "hints" },
		{ op: "remove", hintId: "h1" },
	)
	await vi.advanceTimersByTimeAsync(0)
})

it.each([1, 7])("confirms %i revealers with exact snapshot warning; Cancel sends nothing", async (count) => {
	const snapshot = { ...props, revealers: { h1: Array.from({ length: count }, (_, index) => `Team ${index}`) } }
	let opened = remove(snapshot)
	expect(opened.html).toContain("Remove this hint?")
	expect(opened.html).toContain(
		count === 1 ? "1 team revealed it. It keeps its −5p penalty." : "7 teams revealed it. They keep its −5p penalty.",
	)
	expect(hooks.showModal).toHaveBeenCalled()
	expect(patchSeasonList).not.toHaveBeenCalled()
	opened.buttons.find((button) => button.props.children === "Cancel")?.props.onClick?.()
	nodes(opened.tree, "dialog")[0]?.props.onClose?.()
	expect(view(snapshot).html).not.toContain("<dialog")
	expect(patchSeasonList).not.toHaveBeenCalled()
	opened = remove(snapshot)
	opened.buttons.find((button) => button.props.children === "Remove hint")?.props.onClick?.()
	await vi.advanceTimersByTimeAsync(0)
	expect(patchSeasonList).toHaveBeenCalledExactlyOnceWith(
		"season",
		{ arcId: "arc", questId: "quest", field: "hints" },
		{ op: "remove", hintId: "h1" },
	)
	expect(view(snapshot).html).toContain(">20p</b>")
})

it("keeps new hint through StrictMode effect replay", async () => {
	add()
	const state = [...rows.values()].at(-1)
	if (!state) throw new Error("Missing new row")
	for (const effect of state.effects.values()) effect.cleanup?.()
	for (const effect of state.effects.values()) effect.cleanup = effect.setup() || undefined
	expect(view().textareas).toHaveLength(1)
	view().textareas[0]?.props.onChange?.({ target: { value: "Look up", valueAsNumber: Number.NaN } })
	view()
	await vi.advanceTimersByTimeAsync(500)
	expect(patchSeasonList).toHaveBeenCalledOnce()
})

it("retains failed creation and buffers edits through provider retry without adding twice", async () => {
	vi.mocked(patchSeasonList).mockResolvedValueOnce({ ok: false })
	add().textareas[0]?.props.onChange?.({ target: { value: "Look up", valueAsNumber: Number.NaN } })
	view()
	await vi.advanceTimersByTimeAsync(500)
	expect(view().html).toContain("Not saved")
	view().textareas[0]?.props.onChange?.({ target: { value: "Look higher", valueAsNumber: Number.NaN } })
	view()
	await vi.advanceTimersByTimeAsync(500)
	expect(patchSeasonList).toHaveBeenCalledOnce()
	expect(saveSeasonField).not.toHaveBeenCalled()
	;(hooks.context as { retryAll: () => void }).retryAll()
	await vi.advanceTimersByTimeAsync(500)
	expect(patchSeasonList).toHaveBeenCalledTimes(2)
	expect(saveSeasonField).toHaveBeenCalledOnce()
	expect(view().textareas[0]?.props.value).toBe("Look higher")
})

it("removes a pending creation after add, without late field writes", async () => {
	let finish!: (result: { ok: boolean }) => void
	vi.mocked(patchSeasonList).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve
			}),
	)
	add().textareas[0]?.props.onChange?.({ target: { value: "Look up", valueAsNumber: Number.NaN } })
	view().textareas[0]?.props.onBlur?.()
	view().textareas[0]?.props.onChange?.({ target: { value: "Deleted edit", valueAsNumber: Number.NaN } })
	view()
		.buttons.find((button) => button.props.children === "Remove")
		?.props.onClick?.()
	view()
	finish({ ok: true })
	await vi.advanceTimersByTimeAsync(1000)
	expect(patchSeasonList).toHaveBeenCalledTimes(2)
	expect(vi.mocked(patchSeasonList).mock.calls[1]?.[2]).toMatchObject({ op: "remove" })
	expect(saveSeasonField).not.toHaveBeenCalled()
	expect(view().html).toContain(">15p</b>")
})

it("does not resurrect a newly saved hint after another admin removes it", async () => {
	add().textareas[0]?.props.onChange?.({ target: { value: "Look up", valueAsNumber: Number.NaN } })
	view()
	await vi.advanceTimersByTimeAsync(500)
	const operation = vi.mocked(patchSeasonList).mock.calls[0]?.[2]
	if (!operation || !("hint" in operation) || !operation.hint.id) throw new Error("Missing created hint")
	const saved = { ...props, hints: [...props.hints, { ...operation.hint, id: operation.hint.id }] }
	view(saved)
	view(saved)
	view(props)
	view(props)
	expect(view(props).html).not.toContain("Look up")
	expect(view(props).html).toContain(">15p</b>")
})

it("hides all revealer metadata before start, even if reveal history exists", () => {
	const snapshot = { ...props, revealers: { h1: ["Ninjas"] } }
	const resting = view(snapshot)
	expect(resting.html).not.toContain("Revealed by")
	expect(resting.html).not.toContain("Not revealed yet")
	expect(resting.html).not.toContain("Ninjas")
	resting.buttons[0]?.props.onClick?.()
	expect(view(snapshot).html).not.toContain("Revealed by")
	expect(view(snapshot).html).not.toContain("Not revealed yet")
})

it("renders seven neutral wrapping chips in reveal order and quiet unrevealed text", () => {
	const names = ["Rävarna", "Team Kaos", "Fjällräv", "Byggarna", "Glada Gänget", "Lagom", "Ninjas"]
	const teams = names.toReversed().map((name, index) => ({
		name,
		progress: [
			{
				questId: "quest",
				pointsEarned: 0,
				hintsRevealed: [{ hintId: "h1", text: "Hint", points: 5, revealedAt: new Date(names.length - index) }],
			},
		],
	}))
	const snapshot = { ...props, hasStarted: true, revealers: hintRevealers(teams, "quest") }
	const resting = view(snapshot)
	const chips = nodes(resting.tree, "span").filter((node) => node.props.className?.includes("bg-z2"))
	expect(chips.map((chip) => chip.props.children)).toEqual(names)
	expect(resting.html).toContain("Revealed by")
	expect(resting.html).toContain("Not revealed yet")
	expect(nodes(resting.tree, "div").some((node) => node.props.className?.includes("flex flex-wrap"))).toBe(true)
	for (const chip of chips) {
		expect(chip.props.className).toContain("font-cond text-xs text-ink")
		expect(chip.props.className).toContain("max-w-full")
		expect(chip.props.className).toContain("break-all")
		expect(chip.props.className).not.toMatch(/accent|warn|overflow|whitespace-nowrap/)
	}
	expect(resting.inputs).toHaveLength(0)
	expect(resting.textareas).toHaveLength(0)
	expect(resting.html.indexOf("Start from the bottom.")).toBeLessThan(resting.html.indexOf("Revealed by"))
})

it("keeps chips below Remove and Done and accepts refreshed revealers without losing local edits", () => {
	const snapshot = { ...props, hasStarted: true, revealers: { h1: ["Rävarna"] } }
	view(snapshot).buttons[0]?.props.onClick?.()
	const opened = view(snapshot)
	expect(opened.html.indexOf("Done</button>")).toBeLessThan(opened.html.indexOf("Revealed by"))
	opened.textareas[0]?.props.onChange?.({ target: { value: "Local edit", valueAsNumber: Number.NaN } })
	const refreshed = view({ ...snapshot, revealers: { h1: ["Rävarna", "Ninjas"] } })
	expect(refreshed.html).toContain("Ninjas")
	expect(refreshed.textareas[0]?.props.value).toBe("Local edit")
	expect(refreshed.html.indexOf("Rävarna")).toBeLessThan(refreshed.html.indexOf("Ninjas"))
})
