import { Children, cloneElement, type EffectCallback, isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { addArc, addQuest, removeArc } from "@/app/admin/tree-actions"
import { useAutosaveField } from "./autosave-provider"
import { ConfirmDialog } from "./confirm-dialog"
import { SeasonTree } from "./season-tree"

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
}))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: unknown) => {
		const id = `${hooks.path}:${hooks.cursor++}`
		if (!hooks.states.has(id)) hooks.states.set(id, initial)
		return [hooks.states.get(id), (value: unknown) => hooks.states.set(id, value)]
	},
	useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
	useRef: () => ({ current: { querySelector: () => ({ focus: hooks.focus, select: hooks.select }) } }),
	useId: () => "arc-title",
}))
vi.mock("next/navigation", () => ({
	useSelectedLayoutSegments: () => hooks.segments,
	useRouter: () => ({ push: hooks.push, refresh: hooks.refresh }),
}))
vi.mock("next/link", () => ({ default: (props: object) => <a {...props} /> }))
vi.mock("@/app/admin/tree-actions", () => ({ addArc: vi.fn(), addQuest: vi.fn(), removeArc: vi.fn() }))
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
	vi.mocked(addArc).mockResolvedValue({ ok: true, arcId: "new-arc" })
	vi.mocked(addQuest).mockResolvedValue({ ok: true, questId: "new-quest" })
	vi.mocked(removeArc).mockResolvedValue({ ok: true })
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
		const panel = opened.all.find((element) => element.props.onKeyDown)
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
