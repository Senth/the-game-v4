import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core"
import { Children, cloneElement, type EffectCallback, isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { addArc, addQuest, moveArc, moveQuest, removeArc } from "@/app/admin/tree-actions"
import { useAutosaveField } from "./autosave-provider"
import { ConfirmDialog } from "./confirm-dialog"
import { SeasonTree } from "./season-tree"
import type { SortableDragLayer } from "./sortable/drag-layer"

const hooks = vi.hoisted(() => ({
	states: new Map<string, unknown>(),
	path: "",
	cursor: 0,
	effects: [] as EffectCallback[],
	segments: [] as string[],
	push: vi.fn(),
	refresh: vi.fn(),
	focus: vi.fn(),
	select: vi.fn(),
	change: vi.fn(),
	blur: vi.fn(),
	layer: null as Parameters<typeof SortableDragLayer>[0] | null,
	active: null as string | null,
	queue: null as unknown,
	serverItems: null as unknown,
	droppables: [] as string[],
	contextItems: [] as string[],
	dragMove: null as ((event: DragOverEvent) => void) | null,
	overlayRect: null as { top: number; height: number } | null,
	measureDroppableContainers: vi.fn(),
}))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: unknown) => {
		const id = `${hooks.path}:${hooks.cursor++}`
		if (!hooks.states.has(id)) hooks.states.set(id, typeof initial === "function" ? initial() : initial)
		return [hooks.states.get(id), (value: unknown) => hooks.states.set(id, value)]
	},
	useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
	useRef: (initial: unknown) => {
		const id = `${hooks.path}:${hooks.cursor++}`
		if (!hooks.states.has(id))
			hooks.states.set(id, {
				current:
					initial === null
						? { querySelector: () => ({ focus: hooks.focus, select: hooks.select }), querySelectorAll: () => [] }
						: initial,
			})
		return hooks.states.get(id)
	},
	useId: () => "arc-title",
}))
vi.mock("next/navigation", () => ({
	useSelectedLayoutSegments: () => hooks.segments,
	useRouter: () => ({ push: hooks.push, refresh: hooks.refresh }),
}))
vi.mock("next/link", () => ({ default: (props: object) => <a {...props} /> }))
vi.mock("@/app/admin/tree-actions", () => ({
	addArc: vi.fn(),
	addQuest: vi.fn(),
	removeArc: vi.fn(),
	moveArc: vi.fn(),
	moveQuest: vi.fn(),
}))
vi.mock("@dnd-kit/core", () => ({
	useDndContext: () => ({
		dragOverlay: { rect: hooks.overlayRect },
		measureDroppableContainers: hooks.measureDroppableContainers,
	}),
	useDndMonitor: ({ onDragMove }: { onDragMove: (event: DragOverEvent) => void }) => {
		hooks.dragMove = onDragMove
	},
	useDroppable: ({ id }: { id: string }) => {
		hooks.droppables.push(id)
		return { setNodeRef: () => {} }
	},
}))
vi.mock("@dnd-kit/sortable", () => ({
	SortableContext: ({ children, items }: { children: ReactNode; items: string[] }) => {
		hooks.contextItems = items
		return children
	},
	verticalListSortingStrategy: vi.fn(),
}))
vi.mock("./sortable/drag-layer", async (importOriginal) => {
	const original = await importOriginal<typeof import("./sortable/drag-layer")>()
	return {
		SortableDragLayer: (props: Parameters<typeof original.SortableDragLayer>[0]) => {
			hooks.layer = props
			return props.children
		},
		SortableRow: ({ id, children, keyboard, disabled }: Parameters<typeof original.SortableRow>[0]) => (
			<li>
				{hooks.active === id && (
					<div className="absolute inset-0 rounded-md border border-dashed border-accent/60 bg-accent/5" />
				)}
				<div className={hooks.active === id ? "invisible" : undefined}>
					{children({
						ref: () => {},
						className: "select-none",
						"aria-roledescription": "sortable",
						onKeyDown: (event) => {
							if (!disabled) original.reorderOnKeyDown(keyboard.arcs, keyboard.item, event, keyboard.onMove)
						},
					})}
				</div>
			</li>
		),
	}
})
vi.mock("./sortable/use-move-queue", async () => {
	const { createMoveQueue } = await import("./sortable/move-queue")
	return {
		useMoveQueue: <Items, Move>(
			_target: object,
			items: Items,
			apply: (items: Items, move: Move) => Items,
			save: (move: Move) => Promise<{ ok: boolean }>,
		) => {
			if (!hooks.queue) hooks.queue = createMoveQueue({ items, apply, save, onChange() {}, onState() {} })
			const queue = hooks.queue as ReturnType<typeof createMoveQueue<Items, Move>>
			if (hooks.serverItems !== items) {
				hooks.serverItems = items
				queue.sync(items)
			}
			return { items: queue.items, move: queue.move, setDragging: queue.setDragging, failed: queue.state === "failed" }
		},
	}
})
vi.mock("./autosave-provider", () => ({ useAutosaveField: vi.fn(), useAutosave: () => null }))
vi.mock("./confirm-dialog", async (importOriginal) => ({
	...(await importOriginal<typeof import("./confirm-dialog")>()),
	ConfirmDialog: vi.fn(({ open, title, body, confirmLabel, disabled, onConfirm, onClose }) =>
		open ? (
			<dialog>
				<h2>{title}</h2>
				<p>{body}</p>
				<button type="button" onClick={onClose}>
					Cancel
				</button>
				<button type="button" disabled={disabled} onClick={onConfirm}>
					{confirmLabel}
				</button>
			</dialog>
		) : null,
	),
}))

const now = new Date("2026-10-12T17:00:00Z").getTime()
const arc = {
	id: "a1",
	title: "Old Town",
	shuffleQuests: true,
	quests: [{ id: "q1", label: "Harbour map", points: 40 }],
}
const defaults = { seasonId: "s1", tree: { arcs: [arc] }, start: null, end: null, now, variant: "page" as const }
type Props = { children?: ReactNode; onClick?: () => void; className?: string; [key: string]: unknown }
let cleanup: ReturnType<EffectCallback>

function expand(node: ReactNode, path = "root"): ReactNode {
	return Children.toArray(node).map((child, index) => {
		if (!isValidElement<Props>(child)) return child
		const nextPath = `${path}/${child.key ?? index}`
		if (typeof child.type === "function") {
			hooks.path = nextPath
			hooks.cursor = 0
			return expand((child.type as (props: Props) => ReactNode)(child.props), nextPath)
		}
		return child.props.children === undefined ? child : cloneElement(child, {}, expand(child.props.children, nextPath))
	})
}

function elements(node: ReactNode): ReactElement<Props>[] {
	return Children.toArray(node).flatMap((child) =>
		isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : [],
	)
}

function render(props: Partial<Parameters<typeof SeasonTree>[0]> = {}) {
	hooks.effects.length = 0
	hooks.layer = null
	hooks.droppables = []
	const node = expand(<SeasonTree {...defaults} {...props} />)
	const all = elements(node)
	return {
		html: renderToStaticMarkup(node),
		all,
		button(label: string) {
			const button = all.find((element) => element.type === "button" && element.props.children?.toString() === label)
			if (!button) throw new Error(`Missing button ${label}`)
			return button
		},
	}
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.clearAllMocks()
	hooks.states.clear()
	hooks.segments = []
	hooks.active = null
	hooks.overlayRect = null
	hooks.queue = null
	hooks.dragMove = null
	hooks.serverItems = null
	vi.mocked(addArc).mockResolvedValue({ ok: true, arcId: "new-arc" })
	vi.mocked(addQuest).mockResolvedValue({ ok: true, questId: "new-quest" })
	vi.mocked(removeArc).mockResolvedValue({ ok: true })
	vi.mocked(moveArc).mockResolvedValue({ ok: true })
	vi.mocked(moveQuest).mockResolvedValue({ ok: true })
	vi.mocked(useAutosaveField).mockImplementation((_target, serverValue) => ({
		value: serverValue,
		onChange: hooks.change,
		onFocus: vi.fn(),
		onBlur: hooks.blur,
		failed: false,
		error: undefined,
	}))
})
afterEach(() => {
	cleanup?.()
	cleanup = undefined
	vi.useRealTimers()
})

it.each(["menu", "page"] as const)("renders quiet fallbacks, missing points and 44 px quest links in %s", (variant) => {
	const view = render({
		variant,
		tree: { arcs: [{ ...arc, title: " ", quests: [{ id: "q1", label: null, points: null }] }] },
	})
	expect(view.html).toContain("Untitled arc")
	expect(view.html).toContain("Untitled quest")
	expect(view.html).toContain('text-muted">–</span>')
	expect(view.html).toContain('href="/admin/seasons/s1/quests/q1"')
	expect(view.html).toContain("h-11")
	expect(view.html).not.toContain("aria-current")
	expect(view.html).not.toContain("done")
	view.button(variant === "menu" ? "+ Quest" : "+ Quest in Untitled arc")
})

it("marks only the selected desktop quest and keeps points subordinate", () => {
	hooks.segments = ["quests", "q1"]
	const menu = render({ variant: "menu" })
	expect(menu.html).toContain('aria-current="page"')
	expect(menu.html).toContain("border-l-2 border-accent bg-accent/15 text-head")
	expect(menu.html).toContain('text-xs text-muted">40p')
	const page = render()
	expect(page.html).not.toContain("aria-current")
	expect(page.html).toContain("border-t border-z1 text-base")
	expect(page.html).toContain('text-sm font-bold text-head">40p')
	hooks.segments = ["teams", "q1"]
	expect(render({ variant: "menu" }).html).not.toContain("aria-current")
})

it.each([true, false])("saves the flipped shuffle value from %s with an accessible quiet target", (shuffleQuests) => {
	const view = render({ tree: { arcs: [{ ...arc, shuffleQuests }] } })
	const button = view.button(shuffleQuests ? "Random" : "Ordered")
	expect(button.props["aria-label"]).toBe("Shuffle quests in Old Town")
	expect(button.props["aria-pressed"]).toBe(shuffleQuests)
	expect(button.props.className).toContain("h-11")
	button.props.onClick?.()
	expect(hooks.change).toHaveBeenCalledWith(!shuffleQuests)
	expect(useAutosaveField).toHaveBeenCalledWith({ arcId: "a1", field: "shuffleQuests" }, shuffleQuests)
})

it.each(["Done", "Enter", "Escape"])("opens the rename panel and closes on %s", (closing) => {
	render().button("Old Town").props.onClick?.()
	const opened = render()
	expect(opened.html).toContain("bg-z1 py-3")
	expect(opened.html).toContain(">Arc title</label>")
	expect(opened.html).toContain('value="Old Town"')
	expect(useAutosaveField).toHaveBeenCalledWith({ arcId: "a1", field: "title" }, "Old Town")
	for (const effect of hooks.effects) effect()
	expect(hooks.focus).toHaveBeenCalledOnce()
	expect(hooks.select).not.toHaveBeenCalled()
	if (closing === "Done" || closing === "Enter") {
		expect(opened.button("Done").props.type).toBe("submit")
		const form = opened.all.find((element) => element.type === "form")
		const handler = form?.props.onSubmit as (event: object) => void
		handler({ preventDefault: vi.fn() })
	} else {
		const panel = opened.all.find((element) => element.type === "form")
		const handler = panel?.props.onKeyDown as (event: object) => void
		handler({ key: closing, nativeEvent: { isComposing: false }, preventDefault: vi.fn() })
	}
	expect(render().html).not.toContain("<input")
})

it("keeps only one arc panel open", () => {
	const props = { tree: { arcs: [arc, { ...arc, id: "a2", title: "Finale", quests: [] }] } }
	render(props).button("Old Town").props.onClick?.()
	render(props).button("Finale").props.onClick?.()
	const view = render(props)
	expect(view.html.match(/<input/g)).toHaveLength(1)
	expect(view.html).toContain('value="Finale"')
	view.button("Old Town")
})

it("adds an arc, refreshes the tree and opens its title selected", async () => {
	render().button("+ Arc").props.onClick?.()
	await vi.waitFor(() => expect(hooks.refresh).toHaveBeenCalledOnce())
	expect(addArc).toHaveBeenCalledWith("s1")
	const props = { tree: { arcs: [...defaults.tree.arcs, { ...arc, id: "new-arc", title: "New arc", quests: [] }] } }
	const view = render(props)
	expect(view.html).toContain('value="New arc"')
	for (const effect of hooks.effects) effect()
	expect(hooks.focus).toHaveBeenCalledOnce()
	expect(hooks.select).toHaveBeenCalledOnce()
})

it("adds a quest and navigates to its returned id", async () => {
	render().button("+ Quest in Old Town").props.onClick?.()
	await vi.waitFor(() => expect(hooks.push).toHaveBeenCalledWith("/admin/seasons/s1/quests/new-quest"))
	expect(addQuest).toHaveBeenCalledWith("s1", "a1")
})

it.each(["navigation first", "refresh first"])("marks a newly added desktop quest when %s commits", async (order) => {
	render({ variant: "menu" }).button("+ Quest").props.onClick?.()
	await vi.waitFor(() => expect(hooks.push).toHaveBeenCalledWith("/admin/seasons/s1/quests/new-quest"))
	const tree = { arcs: [{ ...arc, quests: [...arc.quests, { id: "new-quest", label: null, points: null }] }] }
	if (order === "navigation first") {
		hooks.segments = ["quests", "new-quest"]
		expect(render({ variant: "menu" }).html).not.toContain('aria-current="page"')
	} else {
		expect(render({ variant: "menu", tree }).html).not.toContain('aria-current="page"')
		hooks.segments = ["quests", "new-quest"]
	}
	const selected = render({ variant: "menu", tree }).all.find((element) => element.props["aria-current"] === "page")
	expect(selected?.props.href).toBe("/admin/seasons/s1/quests/new-quest")
	expect(selected?.props.className).toContain("border-l-2 border-accent bg-accent/15 text-head")
	expect(render({ variant: "menu", tree }).html).toContain("Untitled quest")
})

it.each([1, 5])("confirms removal of an arc with %i quests before writing", async (count) => {
	const props = {
		tree: {
			arcs: [
				{
					...arc,
					quests: Array.from({ length: count }, (_, index) => ({ label: "Harbour map", points: 40, id: `q${index}` })),
				},
			],
		},
	}
	render(props).button("Old Town").props.onClick?.()
	render(props).button("Remove arc").props.onClick?.()
	const view = render(props)
	expect(removeArc).not.toHaveBeenCalled()
	expect(view.html).toContain("Remove Old Town?")
	expect(view.html).toContain(count === 1 ? "This also removes its quest." : "This also removes its 5 quests.")
	const dialog = view.all.find((element) => element.type === "dialog")
	const confirm = elements(dialog).filter((element) => element.type === "button")[1]
	confirm?.props.onClick?.()
	await vi.waitFor(() => expect(removeArc).toHaveBeenCalledWith("s1", "a1"))
	expect(hooks.refresh).toHaveBeenCalledOnce()
})

it("cancels confirmation without deleting", () => {
	render().button("Old Town").props.onClick?.()
	render().button("Remove arc").props.onClick?.()
	render().button("Cancel").props.onClick?.()
	expect(render().html).not.toContain("<dialog")
	expect(removeArc).not.toHaveBeenCalled()
})

it("removes an empty arc without confirmation", async () => {
	const props = { tree: { arcs: [{ ...arc, quests: [] }] } }
	render(props).button("Old Town").props.onClick?.()
	render(props).button("Remove arc").props.onClick?.()
	await vi.waitFor(() => expect(hooks.refresh).toHaveBeenCalledOnce())
	expect(removeArc).toHaveBeenCalledWith("s1", "a1")
	expect(render(props).html).not.toContain("<dialog")
})

it.each([now + 60_000, now])("hides structural controls for live or ended seasons ending at %i", (end) => {
	const props = { start: new Date(now - 60_000), end: new Date(end) }
	const closed = render(props)
	expect(closed.html).not.toContain("+ Quest")
	expect(closed.html).not.toContain("+ Arc")
	closed.button("Random")
	closed.button("Old Town").props.onClick?.()
	const opened = render(props)
	expect(opened.html).toContain("Arc title")
	expect(opened.html).not.toContain("Remove arc")
})

it("removes controls and disables an open confirmation when the clock crosses start", async () => {
	const props = { start: new Date(now + 1000), end: new Date(now + 600_000) }
	render(props).button("Old Town").props.onClick?.()
	render(props).button("Remove arc").props.onClick?.()
	render(props)
	cleanup = hooks.effects[0]?.()
	await vi.advanceTimersByTimeAsync(1000)
	const view = render(props)
	expect(view.html).not.toContain("+ Quest")
	expect(view.html).not.toContain("+ Arc")
	expect(vi.mocked(ConfirmDialog).mock.lastCall?.[0].disabled).toBe(true)
	expect(view.html).toContain("Arc title")
	expect(view.html.match(/Remove arc/g)).toHaveLength(1)
})

it("offers the first arc for an empty season", () => {
	const view = render({ tree: { arcs: [] } })
	expect(view.html).toContain("No arcs yet.")
	view.button("+ Arc")
})

it.each(["arc", "quest", "remove"])("puts failed %s actions below their control and enables retry", async (control) => {
	vi.mocked(addArc).mockResolvedValue({ ok: false, error: "The game has started." })
	vi.mocked(addQuest).mockResolvedValue({ ok: false, error: "The game has started." })
	vi.mocked(removeArc).mockResolvedValue({ ok: false, error: "The game has started." })
	const props = { tree: { arcs: [{ ...arc, quests: [] }] } }
	if (control === "remove") render(props).button("Old Town").props.onClick?.()
	const label = control === "arc" ? "+ Arc" : control === "quest" ? "+ Quest in Old Town" : "Remove arc"
	render(props).button(label).props.onClick?.()
	await vi.waitFor(() => expect(render(props).html).toContain("The game has started."))
	const view = render(props)
	expect(view.html.match(/role="alert"/g)).toHaveLength(1)
	expect(view.html).toContain("text-warn")
	expect(view.button(label).props.disabled).toBe(false)
	expect(view.html.indexOf("The game has started.")).toBeGreaterThan(view.html.indexOf(label))
	expect(hooks.push).not.toHaveBeenCalled()
	expect(hooks.refresh).not.toHaveBeenCalled()
})

it("disables structural actions while pending and reports network errors", async () => {
	let reject!: (error: Error) => void
	vi.mocked(addQuest).mockReturnValueOnce(
		new Promise((_resolve, fail) => {
			reject = fail
		}),
	)
	render().button("+ Quest in Old Town").props.onClick?.()
	expect(render().button("+ Arc").props.disabled).toBe(true)
	reject(new Error("offline"))
	await vi.waitFor(() => expect(render().html).toContain("Not saved, retry"))
	expect(render().button("+ Arc").props.disabled).toBe(false)
})

it("shows a failed shuffle warning below the toggle", () => {
	vi.mocked(useAutosaveField).mockReturnValue({
		value: true,
		onChange: hooks.change,
		onFocus: vi.fn(),
		onBlur: hooks.blur,
		failed: true,
		error: "Invalid value.",
	})
	const view = render()
	expect(view.button("Random").props.className).toContain("border-warn")
	expect(view.html).toContain('role="alert"')
	expect(view.html).toContain("Invalid value.")
})

const dragTree = {
	arcs: [
		{
			...arc,
			quests: [
				...arc.quests,
				{ id: "q2", label: "Church bells", points: 20 },
				{ id: "q3", label: "Clock tower", points: 30 },
				{ id: "q4", label: "Cobblestones", points: 10 },
			],
		},
		{ ...arc, id: "a2", title: "Finale", shuffleQuests: false, quests: [{ id: "q5", label: "Last word", points: 50 }] },
		{ ...arc, id: "a3", title: "Empty arc", shuffleQuests: false, quests: [] },
	],
}
function dragEvent(id: string, overId: string | null = null, top = 0) {
	return {
		active: { id, rect: { current: { translated: { top, height: 44 } } } },
		over: overId === null ? null : { id: overId, rect: { top: 44, height: 44 } },
	} as DragOverEvent & DragEndEvent & DragStartEvent
}
function lift(id: string, props: Parameters<typeof render>[0]) {
	hooks.active = id
	hooks.layer?.onDragStart(dragEvent(id))
	hooks.overlayRect = { top: 300, height: 48 }
	render(props)
	for (const effect of hooks.effects) effect()
}
function key(element: ReactElement<Props> | undefined, direction: "ArrowUp" | "ArrowDown", shiftKey = false) {
	if (!element) throw new Error("Missing keyboard target")
	const target = {}
	const event = {
		key: direction,
		altKey: true,
		shiftKey,
		target,
		currentTarget: target,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
	}
	;(element.props.onKeyDown as (event: object) => void)?.(event)
	return event
}
function questLinks(view: ReturnType<typeof render>) {
	return view.all.filter((element) => element.type === "a")
}

it.each(["menu", "page"] as const)(
	"wires resting rows without handles, keeping shuffle and rename panels outside drag sources in %s",
	(variant) => {
		const view = render({ variant, tree: dragTree })
		expect(view.button("Old Town").props["aria-roledescription"]).toBe("sortable")
		expect(questLinks(view).every((link) => link.props["aria-roledescription"] === "sortable")).toBe(true)
		expect(questLinks(view).every((link) => link.props.role === "link")).toBe(true)
		expect(view.button("Random").props["aria-roledescription"]).toBeUndefined()
		expect(view.html).not.toMatch(/handle|draggable="true"/i)
		view.button("Old Town").props.onClick?.()
		const opened = render({ variant, tree: dragTree })
		expect(
			opened.all
				.filter((node) => node.type === "input" || node.type === "form")
				.every((node) => !node.props["aria-roledescription"]),
		).toBe(true)
	},
)

it.each(["menu", "page"] as const)(
	"folds pointer arc lifts to 44 px summary rows and hides add controls in %s",
	(variant) => {
		const props = { variant, tree: dragTree }
		render(props)
		lift("a1", props)
		const view = render(props)
		expect(view.html).toContain("4 quests · Random")
		expect(hooks.contextItems).toEqual(["a1", "a2", "a3"])
		expect(view.html).toContain("No quests · Ordered")
		expect(view.html).not.toContain("Harbour map")
		expect(view.html).not.toContain("+ Quest")
		expect(view.html).not.toContain("+ Arc")
		expect(view.html).toContain("border-dashed border-accent/60 bg-accent/5")
		expect(
			view.all
				.filter((node) => node.type === "button" && node.props["aria-roledescription"])
				.every((node) => node.props.className?.includes("min-h-11")),
		).toBe(true)
		hooks.layer?.onDragCancel(dragEvent("a1"))
		hooks.active = null
		expect(render(props).html).toContain("Harbour map")
		expect(moveArc).not.toHaveBeenCalled()
	},
)

it.each(["menu", "page"] as const)(
	"anchors the overlay before folding and refreshes upward arc targets in %s",
	async (variant) => {
		const props = { variant, tree: dragTree }
		render(props)
		hooks.active = "a2"
		hooks.layer?.onDragStart(dragEvent("a2"))
		expect(render(props).html).toContain("Harbour map")
		for (const effect of hooks.effects) effect()
		expect(render(props).html).toContain("Harbour map")
		hooks.overlayRect = { top: 300, height: 48 }
		render(props)
		for (const effect of hooks.effects) effect()
		expect(render(props).html).not.toContain("Harbour map")
		for (const effect of hooks.effects) effect()
		expect(hooks.measureDroppableContainers).toHaveBeenCalled()
		hooks.layer?.onDragOver?.(dragEvent("a2", "a1", 0))
		render(props)
		hooks.layer?.onDragEnd(dragEvent("a2", "a1", 0))
		await vi.waitFor(() => expect(moveArc).toHaveBeenCalledWith({ seasonId: "s1", id: "a2", beforeId: "a1" }))
		expect(render(props).html.indexOf(">Finale<")).toBeLessThan(render(props).html.indexOf(">Old Town<"))
	},
)

it.each(["menu", "page"] as const)("moves an arc by pointer, sending only its target in %s", async (variant) => {
	const props = { variant, tree: dragTree }
	render(props)
	lift("a1", props)
	render(props)
	hooks.layer?.onDragOver?.(dragEvent("a1", "a2", 88))
	render(props)
	hooks.layer?.onDragEnd(dragEvent("a1", "a2"))
	hooks.active = null
	await vi.waitFor(() => expect(moveArc).toHaveBeenCalledWith({ seasonId: "s1", id: "a1", beforeId: "a3" }))
	const view = render(props)
	expect(view.html.indexOf(">Finale<")).toBeLessThan(view.html.indexOf(">Old Town<"))
	expect(view.html).toContain("Harbour map")
})

it.each(["q2", "q5", "empty:a3"])("moves a quest within, across or into empty arcs over %s", async (overId) => {
	const props = { tree: dragTree }
	render(props)
	lift("q1", props)
	render(props)
	expect(hooks.droppables).toContain("empty:a3")
	hooks.layer?.onDragOver?.(dragEvent("q1", overId, overId === "q2" ? 88 : 0))
	const preview = render(props)
	expect(hooks.contextItems).toHaveLength(5)
	expect(hooks.contextItems).toContain("q1")
	expect(hooks.contextItems).not.toContain("a1")
	expect(preview.html).toContain("border-dashed border-accent/60 bg-accent/5")
	expect(preview.html).toContain("+ Quest")
	expect(preview.html).not.toContain("4 quests · Random")
	expect(questLinks(preview).every((link) => link.props.className?.includes("text-muted"))).toBe(true)
	expect(preview.html).not.toContain("font-bold text-head")
	const section = preview.all.find(
		(node) => node.type === "section" && renderToStaticMarkup(node).includes("Harbour map"),
	)
	expect(renderToStaticMarkup(section)).toContain(
		overId === "q2" ? "Old Town" : overId === "q5" ? "Finale" : "Empty arc",
	)
	hooks.layer?.onDragEnd(dragEvent("q1", "q1"))
	hooks.active = null
	const toArcId = overId === "q2" ? "a1" : overId === "q5" ? "a2" : "a3"
	const beforeId = overId === "q2" ? "q3" : overId === "q5" ? "q5" : null
	await vi.waitFor(() => expect(moveQuest).toHaveBeenCalledWith({ seasonId: "s1", id: "q1", toArcId, beforeId }))
	expect(render(props).html).toContain("Harbour map")
})

it("discards a cross-arc preview on cancel or a drop outside the tree", () => {
	const props = { tree: dragTree }
	for (const cancel of [true, false]) {
		render(props)
		lift("q1", props)
		render(props)
		hooks.layer?.onDragOver?.(dragEvent("q1", "empty:a3"))
		render(props)
		if (cancel) hooks.layer?.onDragCancel(dragEvent("q1"))
		else hooks.layer?.onDragEnd(dragEvent("q1"))
		hooks.active = null
		const view = render(props)
		expect(questLinks(view)[0]?.props.href).toBe("/admin/seasons/s1/quests/q1")
	}
	expect(moveQuest).not.toHaveBeenCalled()
})

it("lets a pointer return a quest before its original neighbor", async () => {
	const props = { tree: dragTree }
	render(props)
	lift("q1", props)
	render(props)
	hooks.layer?.onDragOver?.(dragEvent("q1", "q2", 88))
	render(props)
	hooks.layer?.onDragOver?.(dragEvent("q1", "q1"))
	render(props)
	hooks.layer?.onDragOver?.(dragEvent("q1", "q2", 0))
	const view = render(props)
	expect(questLinks(view)[0]?.props.href).toBe("/admin/seasons/s1/quests/q1")
	hooks.layer?.onDragEnd(dragEvent("q1", "q1"))
	await vi.advanceTimersByTimeAsync(0)
	expect(moveQuest).toHaveBeenCalledWith({ seasonId: "s1", id: "q1", toArcId: "a1", beforeId: "q2" })
})

it("updates the slot when the pointer crosses the same last row's midpoint", () => {
	const props = { tree: dragTree }
	render(props)
	lift("q1", props)
	render(props)
	hooks.layer?.onDragOver?.(dragEvent("q1", "q4", 0))
	const before = questLinks(render(props)).map((node) => node.props.href)
	expect(before.indexOf("/admin/seasons/s1/quests/q1")).toBeLessThan(before.indexOf("/admin/seasons/s1/quests/q4"))
	hooks.dragMove?.(dragEvent("q1", "q4", 88))
	const after = questLinks(render(props)).map((node) => node.props.href)
	expect(after.indexOf("/admin/seasons/s1/quests/q1")).toBeGreaterThan(after.indexOf("/admin/seasons/s1/quests/q4"))
})

it("keeps arc keyboard moves expanded and quest shortcuts target neighboring positions and arcs", async () => {
	const props = { tree: dragTree }
	key(render(props).button("Old Town"), "ArrowDown")
	await vi.advanceTimersByTimeAsync(0)
	await vi.waitFor(() => expect(moveArc).toHaveBeenCalledWith({ seasonId: "s1", id: "a1", beforeId: "a3" }))
	const expanded = render(props)
	expect(expanded.html).toContain("Harbour map")
	expect(expanded.html).toContain("+ Arc")
	expect(expanded.html).not.toContain("4 quests · Random")
	const link = questLinks(expanded).find((node) => node.props.href === "/admin/seasons/s1/quests/q1")
	key(link, "ArrowDown")
	await vi.advanceTimersByTimeAsync(0)
	await vi.waitFor(() =>
		expect(moveQuest).toHaveBeenLastCalledWith({ seasonId: "s1", id: "q1", toArcId: "a1", beforeId: "q3" }),
	)
	key(
		questLinks(render(props)).find((node) => node.props.href === link?.props.href),
		"ArrowUp",
		true,
	)
	await vi.advanceTimersByTimeAsync(0)
	await vi.waitFor(() =>
		expect(moveQuest).toHaveBeenLastCalledWith({ seasonId: "s1", id: "q1", toArcId: "a2", beforeId: null }),
	)
	key(
		questLinks(render(props)).find((node) => node.props.href === link?.props.href),
		"ArrowDown",
		true,
	)
	await vi.advanceTimersByTimeAsync(0)
	await vi.waitFor(() =>
		expect(moveQuest).toHaveBeenLastCalledWith({ seasonId: "s1", id: "q1", toArcId: "a1", beforeId: "q2" }),
	)
})

it.each([now + 60_000, now])("renders no sortable wiring or Alt actions after start with end %i", (end) => {
	const props = { tree: dragTree, start: new Date(now - 60_000), end: new Date(end) }
	const view = render(props)
	expect(hooks.layer).toBeNull()
	expect(hooks.droppables).toEqual([])
	expect(view.html).not.toContain("sortable")
	expect(view.html).not.toContain("select-none")
	expect(view.button("Old Town").props.onKeyDown).toBeUndefined()
	expect(questLinks(view).every((link) => !link.props.onKeyDown && !link.props.onPointerDown)).toBe(true)
	expect(moveArc).not.toHaveBeenCalled()
	expect(moveQuest).not.toHaveBeenCalled()
})

it("keeps a failed move in its dropped position until retry succeeds", async () => {
	vi.mocked(moveQuest).mockResolvedValueOnce({ ok: false, error: "Not saved, retry" })
	const props = { tree: dragTree }
	key(questLinks(render(props))[0], "ArrowDown", true)
	await vi.advanceTimersByTimeAsync(0)
	await vi.waitFor(() => expect(moveQuest).toHaveBeenCalledOnce())
	const view = render(props)
	const section = view.all.find((node) => node.type === "section" && renderToStaticMarkup(node).includes("Harbour map"))
	expect(renderToStaticMarkup(section)).toContain("Finale")
	const queue = hooks.queue as { state: string; retry: () => Promise<void> }
	expect(queue.state).toBe("failed")
	await queue.retry()
	expect(queue.state).toBe("saved")
	expect(moveQuest).toHaveBeenCalledTimes(2)
})
