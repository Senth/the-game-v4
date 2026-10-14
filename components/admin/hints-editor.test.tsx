import { Children, cloneElement, type EffectCallback, isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { saveSeasonField } from "@/app/admin/autosave-actions"
import { AutosavePointsField } from "./autosave-points-field"
import { AutosaveProvider } from "./autosave-provider"
import { HintsEditor } from "./hints-editor"

type Scope = {
	values: unknown[]
	cursor: number
	effects: Map<number, { deps: unknown[]; cleanup?: () => void }>
	pending: (() => void)[]
}
const hooks = vi.hoisted(() => ({
	active: null as unknown as Scope,
	context: null as unknown,
	focus: vi.fn(),
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
		scope.values[index] ??= { current: initial === null ? { focus: hooks.focus } : initial }
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
			scope.effects.set(index, { deps, cleanup: cleanup || undefined })
		})
	},
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/app/admin/autosave-actions", () => ({ saveSeasonField: vi.fn() }))
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
}
let editor: Scope
let rows: Map<string, Scope>
let questPoints: Scope

type NodeProps = {
	children?: ReactNode
	className?: string
	value?: string | number
	onClick?: () => void
	onChange?: (event: { target: { value: string; valueAsNumber: number } }) => void
	onKeyDown?: (event: { key: string; preventDefault: () => void; nativeEvent: { isComposing: boolean } }) => void
}
function nodes(node: ReactNode, type: string): ReactElement<NodeProps>[] {
	return Children.toArray(node).flatMap((child) => {
		if (!isValidElement<NodeProps>(child)) return []
		return child.type === type ? [child] : nodes(child.props.children, type)
	})
}
function view(snapshot = props) {
	let section = run(editor, () => HintsEditor(snapshot))
	const list = section.props.children[1]
	const renderedRows = list.props.children.map((row: ReactElement) => {
		const id = String(row.key)
		if (!rows.has(id)) rows.set(id, scope())
		return run(rows.get(id) as Scope, () => (row.type as (props: unknown) => ReactElement)(row.props))
	})
	section = run(editor, () => HintsEditor(snapshot))
	const tree = cloneElement(section, {}, section.props.children[0], cloneElement(list, {}, renderedRows))
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
	hooks.context = run(scope(), () => AutosaveProvider({ seasonId: "season", children: null })).props.value
	editor = scope()
	rows = new Map()
	questPoints = scope()
})
afterEach(() => {
	for (const state of [editor, ...rows.values(), questPoints]) {
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
	first.buttons.at(-1)?.props.onClick?.()
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
	const refreshed = view(remote)
	expect(refreshed.html).toContain("Remote wording")
	expect(refreshed.html).toContain("5p")
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
