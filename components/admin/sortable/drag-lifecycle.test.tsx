import type { Active, DragEndEvent, DragStartEvent } from "@dnd-kit/core"
import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { SortableDragLayer, SortableRow } from "./drag-layer"

const hooks = vi.hoisted(() => ({
	reducedMotion: false,
	isDragging: false,
	active: null as Active | null,
	cleanups: [] as (() => void)[],
}))

vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (value: unknown) => [value, vi.fn()],
	useRef: (value: unknown) => ({ current: value }),
	useEffect: (effect: EffectCallback) => {
		const cleanup = effect()
		if (cleanup) hooks.cleanups.push(cleanup)
	},
}))
vi.mock("@/components/use-reduced-motion", () => ({ useReducedMotion: () => hooks.reducedMotion }))
vi.mock("@dnd-kit/core", async (original) => ({
	...(await original<typeof import("@dnd-kit/core")>()),
	useSensor: (sensor: unknown, options: unknown) => ({ sensor, options }),
	useSensors: (...sensors: unknown[]) => sensors,
	useDndContext: () => ({ active: hooks.active }),
}))
vi.mock("@dnd-kit/sortable", () => ({
	useSortable: () => ({
		attributes: {},
		listeners: {},
		setNodeRef: vi.fn(),
		setActivatorNodeRef: vi.fn(),
		transform: { x: 10, y: 20, scaleX: 1, scaleY: 1 },
		transition: "transform 200ms ease",
		isDragging: hooks.isDragging,
	}),
}))

beforeEach(() => {
	hooks.reducedMotion = false
	hooks.isDragging = false
	hooks.active = null
	vi.stubGlobal("document", new EventTarget())
	vi.stubGlobal("navigator", { vibrate: vi.fn() })
})

afterEach(() => {
	for (const cleanup of hooks.cleanups.splice(0)) cleanup()
	vi.unstubAllGlobals()
})

it("uses delayed PointerSensor, preserves scrolling until lift, vibrates and swallows the drop click", () => {
	const onDragStart = vi.fn()
	const onDragEnd = vi.fn()
	const layer = SortableDragLayer({
		children: null,
		overlay: () => null,
		onDragStart,
		onDragEnd,
		onDragCancel: vi.fn(),
	})
	expect(layer.props.sensors[0].options).toEqual({ activationConstraint: { delay: 400, tolerance: 5 } })
	expect(layer.props.autoScroll).toBeUndefined()
	const scroll = () => {
		const event = new Event("touchmove", { cancelable: true })
		document.dispatchEvent(event)
		return event.defaultPrevented
	}
	expect(scroll()).toBe(false)
	const start = { active: { id: "a" } } as DragStartEvent
	layer.props.onDragStart(start)
	expect(onDragStart).toHaveBeenCalledWith(start)
	expect(navigator.vibrate).toHaveBeenCalledWith(10)
	expect(scroll()).toBe(true)
	const end = { active: { id: "a" }, over: { id: "b" } } as DragEndEvent
	layer.props.onDragEnd(end)
	expect(onDragEnd).toHaveBeenCalledWith(end)
	expect(scroll()).toBe(false)
	const click = new Event("click", { cancelable: true })
	document.dispatchEvent(click)
	expect(click.defaultPrevented).toBe(true)
})

it("keeps source height through invisible contents and renders H1 dashed slot", () => {
	hooks.isDragging = true
	const row = SortableRow({
		id: "a",
		keyboard: { arcs: [], item: { kind: "arc", id: "a" }, onMove: vi.fn() },
		children: () => (
			<button type="button" className="h-14">
				Tall row
			</button>
		),
	})
	const markup = renderToStaticMarkup(row)
	expect(markup).toContain("absolute inset-0 rounded-md border border-dashed border-accent/60 bg-accent/5")
	expect(markup).toContain('class="invisible"')
	expect(markup).toContain('class="h-14"')
})

it("mutes untouched rows and removes sortable transforms and transitions for reduced motion", () => {
	hooks.active = { id: "other" } as Active
	hooks.reducedMotion = true
	const row = SortableRow({
		id: "a",
		keyboard: { arcs: [], item: { kind: "arc", id: "a" }, onMove: vi.fn() },
		children: () => <button type="button">Row</button>,
	})
	const markup = renderToStaticMarkup(row)
	expect(markup).toContain("text-muted")
	expect(markup).not.toContain("transform:")
	expect(markup).not.toContain("transition:")
	const layer = SortableDragLayer({
		children: null,
		overlay: () => null,
		onDragStart: vi.fn(),
		onDragEnd: vi.fn(),
		onDragCancel: vi.fn(),
	})
	expect(layer.props.children[1].props.dropAnimation).toBeNull()
})
