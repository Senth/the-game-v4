import { isValidElement, type PointerEvent, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import type { PlayerPuzzle } from "@/lib/domain/game"
import { PuzzleBoard } from "./puzzle-board"

const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], state: 0, ref: 0 }))
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useId: () => "picture-title",
	useRef: (value: unknown) => {
		const index = hooks.ref++
		hooks.refs[index] ??= { current: value }
		return hooks.refs[index]
	},
	useState: (initial: unknown) => {
		const index = hooks.state++
		if (!(index in hooks.states)) hooks.states[index] = initial
		return [
			hooks.states[index],
			(next: unknown) => {
				hooks.states[index] = next
			},
		]
	},
}))

const puzzle: PlayerPuzzle = {
	rows: 2,
	cols: 2,
	aspect: 2,
	fullUrl: null,
	pieces: [
		{ id: "a", spot: { x: 0.1, y: 0.2 } },
		{ id: "b", spot: { cell: 1 } },
		{ id: "c", spot: { x: 0.5, y: 0.6 } },
		{ id: "d", spot: { x: 0.7, y: 0.8 } },
	],
}
const onDrop = vi.fn<(id: string, target: unknown) => Promise<void>>()
type Props = Record<string, unknown> & { children?: ReactNode }
function find(node: ReactNode, match: (node: ReactElement<Props>) => boolean): ReactElement<Props> {
	if (isValidElement<Props>(node)) {
		if (match(node)) return node
		return find(node.props.children, match)
	}
	for (const child of Array.isArray(node) ? node : []) {
		try {
			return find(child, match)
		} catch {}
	}
	throw new Error("Element not found")
}
function render(overrides: Partial<Parameters<typeof PuzzleBoard>[0]> = {}) {
	hooks.state = 0
	hooks.ref = 0
	return PuzzleBoard({ questId: "quest", puzzle, onDrop, ...overrides })
}
function area(tree: ReactNode) {
	return find(tree, (node) => node.props.role === "application").props as unknown as {
		onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
		onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
		onPointerUp: (event: PointerEvent<HTMLDivElement>) => Promise<void>
		onPointerCancel: () => void
	}
}
function event(x: number, y: number) {
	return {
		clientX: x,
		clientY: y,
		pointerId: 1,
		isPrimary: true,
		button: 0,
		currentTarget: { setPointerCapture: vi.fn() },
		target: {
			closest: () => ({
				dataset: { piece: "a" },
				getBoundingClientRect: () => ({ left: 10, top: 120, width: 100, height: 50 }),
			}),
		},
	} as unknown as PointerEvent<HTMLDivElement>
}
beforeEach(() => {
	hooks.states = []
	hooks.refs = []
	onDrop.mockReset().mockResolvedValue()
	render()
	hooks.refs[0] = {
		current: {
			getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 }),
		},
	}
	hooks.refs[1] = { current: { getBoundingClientRect: () => ({ left: 0, top: 108, width: 200, height: 100 }) } }
})

it("lifts with pointer capture and marks nearest cell using the piece center", () => {
	const down = event(20, 130)
	area(render()).onPointerDown(down)
	expect(down.currentTarget.setPointerCapture).toHaveBeenCalledWith(1)
	area(render()).onPointerMove(event(110, 10))
	const html = renderToStaticMarkup(render())
	expect(html).toContain("ring-2 ring-accent")
	expect(html).toContain("motion-safe:scale-110")
	expect(html).toContain("border-dashed border-accent bg-accent/15")
	expect(html).toContain("left:50%;top:0%;width:50%;height:50%")
	expect(html).not.toContain("<button")
})

it("snaps and swaps optimistically, then rolls back a failed write", async () => {
	const request = Promise.withResolvers<void>()
	onDrop.mockReturnValue(request.promise)
	area(render()).onPointerDown(event(20, 130))
	const saving = area(render()).onPointerUp(event(110, 10))
	expect(onDrop).toHaveBeenCalledWith("a", { cell: 1 })
	expect(hooks.states[1]).toEqual([
		{ id: "a", spot: { cell: 1 } },
		{ id: "b", spot: { x: 0.1, y: 0.2 } },
		...puzzle.pieces.slice(2),
	])
	request.reject(new Error("Offline"))
	await saving
	expect(hooks.states[1]).toEqual(puzzle.pieces)
	expect(renderToStaticMarkup(render())).toContain("Could not move piece. Try again.")
})

it("keeps a successful loose drop and clamps coordinates to the tray free area", async () => {
	area(render()).onPointerDown(event(20, 130))
	await area(render()).onPointerUp(event(300, 400))
	expect(onDrop).toHaveBeenCalledWith("a", { x: 1, y: 1 })
	expect(hooks.states[1]).toEqual(expect.arrayContaining([{ id: "a", spot: { x: 1, y: 1 } }]))
})

it("cancels without writing, and reconciles a teammate's live board", () => {
	area(render()).onPointerDown(event(20, 130))
	area(render()).onPointerCancel()
	expect(onDrop).not.toHaveBeenCalled()
	const next = { ...puzzle, pieces: puzzle.pieces.map((piece, cell) => ({ ...piece, spot: { cell } })) }
	render({ puzzle: next })
	expect(hooks.states[1]).toEqual(next.pieces)
})

it("opens the native full-picture dialog and closes through its quiet button", () => {
	const showModal = vi.fn()
	const close = vi.fn()
	hooks.refs[2] = { current: { showModal, close } }
	const tree = render({ puzzle: { ...puzzle, fullUrl: "/api/puzzle/quest/full" } })
	const open = find(tree, (node) => node.type === "button" && Array.isArray(node.props.children))
	;(open.props.onClick as () => void)()
	expect(showModal).toHaveBeenCalledOnce()
	const button = find(tree, (node) => node.type === "button" && node.props.children === "Close")
	;(button.props.onClick as () => void)()
	expect(close).toHaveBeenCalledOnce()
	const html = renderToStaticMarkup(tree)
	expect(html).toContain("<dialog")
	expect(html).toContain('aria-labelledby="picture-title"')
	expect(html).toContain("w-24")
})

it("keeps previews inert and completion seamless with an empty tray", () => {
	area(render({ preview: true })).onPointerDown(event(20, 130))
	expect(hooks.states[2]).toBeNull()
	expect(renderToStaticMarkup(render({ preview: true }))).toContain('inert=""')
	expect(onDrop).not.toHaveBeenCalled()
	const solved = { ...puzzle, pieces: puzzle.pieces.map((piece, cell) => ({ ...piece, spot: { cell } })) }
	render({ puzzle: solved })
	const html = renderToStaticMarkup(render({ puzzle: solved, complete: 15 }))
	expect(html).toContain("ring-2 ring-pace-ok")
	expect(html).toContain("Puzzle complete · +15p")
	expect(html).not.toContain("border-z1/50")
	expect(html).toMatch(/bg-z1\/50"[^>]*><\/div>/)
})
