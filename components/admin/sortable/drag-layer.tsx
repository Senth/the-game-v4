"use client"

import {
	type Active,
	DndContext,
	type DragCancelEvent,
	type DragEndEvent,
	type DragOverEvent,
	DragOverlay,
	type DragStartEvent,
	PointerSensor,
	useDndContext,
	useSensor,
	useSensors,
} from "@dnd-kit/core"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
	type HTMLAttributes,
	type KeyboardEvent,
	type ReactNode,
	type RefCallback,
	useEffect,
	useRef,
	useState,
} from "react"
import { useReducedMotion } from "@/components/use-reduced-motion"
import { keyboardTarget } from "@/lib/domain/reorder"

export function swallowClickAfterDrag(target: EventTarget) {
	const swallow = (event: Event) => {
		event.preventDefault()
		event.stopImmediatePropagation()
		cleanup()
	}
	const cleanup = () => {
		target.removeEventListener("click", swallow, { capture: true })
		clearTimeout(timer)
	}
	target.addEventListener("click", swallow, { capture: true })
	const timer = setTimeout(cleanup, 0)
	return cleanup
}

export function DragPreview({ children, reducedMotion }: { children: ReactNode; reducedMotion: boolean }) {
	return (
		<div
			className={`flex min-h-12 items-center gap-3 rounded-md bg-z2 px-3 text-head shadow-[0_8px_24px_rgba(0,0,0,.6)] ${reducedMotion ? "transform-none transition-none" : "rotate-[-1.2deg] -translate-y-1.5"}`}
		>
			{children}
		</div>
	)
}

export function SortableDragLayer({
	children,
	overlay,
	onDragStart,
	onDragOver,
	onDragEnd,
	onDragCancel,
}: {
	children: ReactNode
	overlay: (active: Active) => ReactNode
	onDragStart: (event: DragStartEvent) => void
	onDragOver?: (event: DragOverEvent) => void
	onDragEnd: (event: DragEndEvent) => void
	onDragCancel: (event: DragCancelEvent) => void
}) {
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 400, tolerance: 5 } }))
	const reducedMotion = useReducedMotion()
	const [active, setActive] = useState<Active | null>(null)
	const lifted = useRef(false)
	const cleanupClick = useRef<(() => void) | undefined>(undefined)

	useEffect(() => {
		const preventScroll = (event: TouchEvent) => {
			if (lifted.current && event.cancelable) event.preventDefault()
		}
		document.addEventListener("touchmove", preventScroll, { passive: false })
		return () => {
			document.removeEventListener("touchmove", preventScroll)
			cleanupClick.current?.()
		}
	}, [])

	function finish() {
		lifted.current = false
		setActive(null)
		cleanupClick.current?.()
		cleanupClick.current = swallowClickAfterDrag(document)
	}

	return (
		<DndContext
			sensors={sensors}
			accessibility={{
				screenReaderInstructions: {
					draggable: "Press Alt and Up or Down to move this row. For quests, add Shift to move to a neighboring arc.",
				},
			}}
			onDragStart={(event) => {
				lifted.current = true
				setActive(event.active)
				navigator.vibrate?.(10)
				onDragStart(event)
			}}
			onDragOver={onDragOver}
			onDragEnd={(event) => {
				onDragEnd(event)
				finish()
			}}
			onDragCancel={(event) => {
				onDragCancel(event)
				finish()
			}}
		>
			{children}
			<DragOverlay dropAnimation={reducedMotion ? null : undefined}>
				{active ? <DragPreview reducedMotion={reducedMotion}>{overlay(active)}</DragPreview> : null}
			</DragOverlay>
		</DndContext>
	)
}

type KeyboardItem = Parameters<typeof keyboardTarget>[1]
type KeyboardMove = NonNullable<ReturnType<typeof keyboardTarget>>

export function reorderOnKeyDown(
	arcs: Parameters<typeof keyboardTarget>[0],
	item: KeyboardItem,
	event: Pick<
		KeyboardEvent,
		"key" | "altKey" | "shiftKey" | "target" | "currentTarget" | "preventDefault" | "stopPropagation"
	>,
	onMove: (target: KeyboardMove) => void,
) {
	if (event.target !== event.currentTarget || !event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return
	event.preventDefault()
	event.stopPropagation()
	const target = keyboardTarget(arcs, item, event.key, event)
	if (target) onMove(target)
}

export function SortableRow({
	id,
	disabled = false,
	keyboard,
	children,
}: {
	id: string
	disabled?: boolean
	keyboard: { arcs: Parameters<typeof keyboardTarget>[0]; item: KeyboardItem; onMove: (target: KeyboardMove) => void }
	children: (bindings: HTMLAttributes<HTMLElement> & { ref: RefCallback<HTMLElement> }) => ReactNode
}) {
	const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
		id,
		disabled,
	})
	const { active } = useDndContext()
	const reducedMotion = useReducedMotion()
	return (
		<li
			ref={setNodeRef}
			className={`relative ${active && !isDragging ? "text-muted" : ""}`}
			style={{
				transform: reducedMotion ? undefined : CSS.Transform.toString(transform),
				transition: reducedMotion ? undefined : transition,
			}}
		>
			{isDragging ? (
				<div
					aria-hidden="true"
					className="absolute inset-0 rounded-md border border-dashed border-accent/60 bg-accent/5"
				/>
			) : null}
			<div className={isDragging ? "invisible" : undefined}>
				{children({
					...attributes,
					...listeners,
					ref: setActivatorNodeRef,
					className: "select-none [-webkit-touch-callout:none]",
					onKeyDown: (event) => {
						if (!disabled) reorderOnKeyDown(keyboard.arcs, keyboard.item, event, keyboard.onMove)
					},
				})}
			</div>
		</li>
	)
}
