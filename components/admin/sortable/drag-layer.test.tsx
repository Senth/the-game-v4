import { DndContext } from "@dnd-kit/core"
import { SortableContext } from "@dnd-kit/sortable"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, it, vi } from "vitest"
import type { Arc } from "@/lib/domain/schemas"
import { DragPreview, reorderOnKeyDown, SortableDragLayer, SortableRow, swallowClickAfterDrag } from "./drag-layer"

afterEach(() => vi.useRealTimers())

it("swallows only the click following a drag, including its default navigation", () => {
	vi.useFakeTimers()
	const target = new EventTarget()
	const cleanup = swallowClickAfterDrag(target)
	const click = vi.fn()
	target.addEventListener("click", click)
	const event = new Event("click", { cancelable: true })
	target.dispatchEvent(event)
	expect(event.defaultPrevented).toBe(true)
	expect(click).not.toHaveBeenCalled()
	target.dispatchEvent(new Event("click"))
	expect(click).toHaveBeenCalledOnce()
	cleanup()
	expect(vi.getTimerCount()).toBe(0)
})

it("does not swallow a later ordinary click if no click follows the drop", () => {
	vi.useFakeTimers()
	const target = new EventTarget()
	swallowClickAfterDrag(target)
	vi.runAllTimers()
	const event = new Event("click", { cancelable: true })
	target.dispatchEvent(event)
	expect(event.defaultPrevented).toBe(false)
})

it("switches lifted-row motion classes without changing H1 colors and spacing", () => {
	const normal = renderToStaticMarkup(<DragPreview reducedMotion={false}>Hint</DragPreview>)
	const reduced = renderToStaticMarkup(<DragPreview reducedMotion>Hint</DragPreview>)
	for (const markup of [normal, reduced])
		expect(markup).toContain("min-h-12 items-center gap-3 rounded-md bg-z2 px-3 text-head")
	expect(normal).toContain("rotate-[-1.2deg] -translate-y-1.5")
	expect(reduced).toContain("transform-none transition-none")
	expect(reduced).not.toMatch(/rotate-|translate-/)
})

it("renders selectable-free rows and keeps normal interactive children at rest", () => {
	const html = renderToStaticMarkup(
		<DndContext>
			<SortableContext items={["a"]}>
				<ul>
					<SortableRow id="a" keyboard={{ arcs: [], item: { kind: "arc", id: "a" }, onMove: vi.fn() }}>
						{(bindings) => (
							<button type="button" {...bindings}>
								Open arc
							</button>
						)}
					</SortableRow>
				</ul>
			</SortableContext>
		</DndContext>,
	)
	expect(html).toContain("select-none [-webkit-touch-callout:none]")
	expect(html).toContain("Open arc")
	expect(html).not.toContain("border-dashed")
})

it("keeps the overlay absent until a pointer lift", () => {
	const html = renderToStaticMarkup(
		<SortableDragLayer overlay={() => null} onDragStart={vi.fn()} onDragEnd={vi.fn()} onDragCancel={vi.fn()}>
			<ul />
		</SortableDragLayer>,
	)
	expect(html).toBe("<ul></ul>")
})

it("keeps instruction identities stable across server renders and distinct across drag layers", () => {
	const layer = (id: string) => (
		<SortableDragLayer overlay={() => null} onDragStart={vi.fn()} onDragEnd={vi.fn()} onDragCancel={vi.fn()}>
			<SortableContext items={[id]}>
				<ul>
					<SortableRow id={id} keyboard={{ arcs: [], item: { kind: "arc", id }, onMove: vi.fn() }}>
						{(bindings) => (
							<button type="button" {...bindings}>
								Open {id}
							</button>
						)}
					</SortableRow>
				</ul>
			</SortableContext>
		</SortableDragLayer>
	)
	const tree = (
		<>
			{layer("arc")}
			{layer("hint")}
		</>
	)
	const descriptions = (html: string) => [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((match) => match[1])
	const first = descriptions(renderToStaticMarkup(tree))
	expect(first).toHaveLength(2)
	expect(new Set(first).size).toBe(2)
	expect(descriptions(renderToStaticMarkup(tree))).toEqual(first)
})

const arcs = [
	{ id: "a", quests: [] },
	{ id: "b", quests: [] },
] as unknown as Arc[]
function keyEvent(overrides = {}) {
	const row = {} as HTMLElement
	return {
		key: "ArrowDown",
		altKey: true,
		shiftKey: false,
		target: row,
		currentTarget: row,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
		...overrides,
	}
}

it("one Alt+Arrow keystroke moves once; list edges stay put", () => {
	const move = vi.fn()
	const event = keyEvent()
	reorderOnKeyDown(arcs, { kind: "arc", id: "a" }, event, move)
	expect(move).toHaveBeenCalledExactlyOnceWith({ beforeId: null })
	expect(event.preventDefault).toHaveBeenCalledOnce()
	const edge = keyEvent()
	reorderOnKeyDown(arcs, { kind: "arc", id: "b" }, edge, move)
	expect(move).toHaveBeenCalledOnce()
	expect(edge.preventDefault).toHaveBeenCalledOnce()
})

it("ignores ordinary arrows and events from editing descendants", () => {
	const move = vi.fn()
	for (const event of [keyEvent({ altKey: false }), keyEvent({ target: {} }), keyEvent({ key: "Enter" })]) {
		reorderOnKeyDown(arcs, { kind: "arc", id: "a" }, event, move)
		expect(event.preventDefault).not.toHaveBeenCalled()
	}
	expect(move).not.toHaveBeenCalled()
})

it("Alt+Shift+Arrow moves a quest across arcs in one keystroke", () => {
	const move = vi.fn()
	const tree = [
		{ id: "a", quests: [{ id: "q" }] },
		{ id: "b", quests: [{ id: "r" }] },
	] as unknown as Arc[]
	reorderOnKeyDown(tree, { kind: "quest", id: "q" }, keyEvent({ shiftKey: true }), move)
	expect(move).toHaveBeenCalledExactlyOnceWith({ toArcId: "b", beforeId: "r" })
})
