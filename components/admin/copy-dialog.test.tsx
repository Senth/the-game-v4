import { Children, isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { copyArc, getCopyDestinations } from "@/app/admin/copy-actions"
import { CopyDialog } from "./copy-dialog"

const hooks = vi.hoisted(() => ({
	state: new Map<number, unknown>(),
	cursor: 0,
	effects: [] as (() => void)[],
}))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: unknown) => {
		const index = hooks.cursor++
		if (!hooks.state.has(index)) hooks.state.set(index, initial)
		return [hooks.state.get(index), (value: unknown) => hooks.state.set(index, value)]
	},
	useEffect: (effect: () => void) => hooks.effects.push(effect),
}))
vi.mock("@/app/admin/copy-actions", () => ({ copyArc: vi.fn(), getCopyDestinations: vi.fn() }))
vi.mock("./confirm-dialog", () => ({ ConfirmDialog: vi.fn(() => null) }))

const arc = {
	id: "arc-1",
	title: "Lighthouse",
	hintCount: 1,
	quests: [{ id: "quest-1", label: "Harbour map", points: 40 }],
}
const destinations = [
	{ id: "spring", title: "Spring Hunt 2027", status: "unscheduled" as const, start: null, arcs: [] },
	{
		id: "summer",
		title: "Summer Relay",
		status: "upcoming" as const,
		start: new Date("2027-06-14T12:00:00Z"),
		arcs: [],
	},
]
type DialogProps = {
	open: boolean
	title: string
	body: ReactNode
	cancelLabel?: string
	confirmLabel?: string
	disabled: boolean
	closeOnConfirm: boolean
	error?: string | null
	result?: { label: string; href: string }
	onConfirm: () => void
}
type ElementProps = {
	children?: ReactNode
	value?: string
	onChange?: (event: { target: { value: string } }) => void
}

function render(props: Partial<Parameters<typeof CopyDialog>[0]> = {}) {
	hooks.cursor = 0
	hooks.effects.length = 0
	const dialog = CopyDialog({
		open: true,
		sourceSeasonId: "source",
		sourceSeasonTitle: "Cipher Night 2026",
		arc,
		onClose: vi.fn(),
		...props,
	})
	if (!isValidElement<DialogProps>(dialog)) throw new Error("Missing copy dialog")
	return {
		props: dialog.props,
		html: renderToStaticMarkup(dialog.props.body),
		runEffects() {
			for (const effect of hooks.effects) effect()
		},
	}
}

function find(
	node: ReactNode,
	predicate: (element: ReactElement<ElementProps>) => boolean,
): ReactElement<ElementProps> | undefined {
	for (const child of Children.toArray(node)) {
		if (!isValidElement<ElementProps>(child)) continue
		if (predicate(child)) return child
		const nested = find(child.props.children, predicate)
		if (nested) return nested
	}
}

beforeEach(() => {
	hooks.state.clear()
	vi.clearAllMocks()
	vi.mocked(getCopyDestinations).mockResolvedValue({ ok: true, destinations })
	vi.mocked(copyArc).mockResolvedValue({ ok: true, seasonId: "spring", arcId: "copied" })
})

it("loads destinations on open and shows muted loading with confirm disabled", async () => {
	let finish!: (value: Awaited<ReturnType<typeof getCopyDestinations>>) => void
	vi.mocked(getCopyDestinations).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
	const view = render()
	view.runEffects()
	expect(getCopyDestinations).toHaveBeenCalledWith("source")
	expect(view.html).toContain("Finding seasons…")
	expect(view.props.disabled).toBe(true)
	finish({ ok: true, destinations })
	await vi.waitFor(() => expect(render().props.disabled).toBe(false))
})

it("shows pluralized source summary and selects first destination", async () => {
	const view = render()
	view.runEffects()
	await vi.waitFor(() => expect(render().props.disabled).toBe(false))
	const loaded = render()
	expect(loaded.html).toContain("From Cipher Night 2026 · 1 quest · 1 hint")
	expect(loaded.html).toContain("Upcoming · 14 Jun")
	expect(loaded.html).toContain('checked="" value="spring"')
	expect(loaded.props.confirmLabel).toBe("Copy arc")
})

it("pluralizes quest and hint counts in summary and result", async () => {
	const source = { ...arc, hintCount: 3, quests: [...arc.quests, { id: "quest-2", label: "Fog horn", points: 20 }] }
	const view = render({ arc: source })
	view.runEffects()
	await vi.waitFor(() => expect(render({ arc: source }).props.disabled).toBe(false))
	expect(render({ arc: source }).html).toContain("From Cipher Night 2026 · 2 quests · 3 hints")
	await (render({ arc: source }).props.onConfirm as () => Promise<void>)()
	expect(render({ arc: source }).props.body).toBe("Lighthouse is now the last arc there, with 2 new quests.")
})

it("shows Close only when no destination is waiting", async () => {
	vi.mocked(getCopyDestinations).mockResolvedValueOnce({ ok: true, destinations: [] })
	const view = render()
	view.runEffects()
	await vi.waitFor(() => expect(render().props.cancelLabel).toBe("Close"))
	const empty = render()
	expect(empty.html).toContain("No season is waiting to start. Create one first.")
	expect(empty.props.confirmLabel).toBeUndefined()
	expect(empty.props.cancelLabel).toBe("Close")
})

it("keeps dialog open after copy error so another destination can be selected", async () => {
	vi.mocked(copyArc).mockResolvedValueOnce({ ok: false, error: "Summer Relay has started. Pick another season." })
	const view = render()
	view.runEffects()
	await vi.waitFor(() => expect(render().props.disabled).toBe(false))
	const loaded = render()
	const confirm = loaded.props.onConfirm as () => Promise<void>
	await confirm()
	const failed = render()
	expect(failed.props.open).toBe(true)
	expect(failed.props.closeOnConfirm).toBe(false)
	expect(failed.props.error).toBe("Summer Relay has started. Pick another season.")
	const radio = find(failed.props.body, (element) => element.type === "input" && element.props.value === "summer")
	radio?.props.onChange?.({ target: { value: "summer" } })
	const changed = render()
	expect(changed.html).toContain('checked="" value="summer"')
})

it("shows copied result and destination route", async () => {
	const view = render()
	view.runEffects()
	await vi.waitFor(() => expect(render().props.disabled).toBe(false))
	await (render().props.onConfirm as () => Promise<void>)()
	const result = render()
	expect(result.props.title).toBe("Copied to Spring Hunt 2027")
	expect(result.props.body).toBe("Lighthouse is now the last arc there, with 1 new quest.")
	expect(result.props.result).toEqual({ label: "Open it ›", href: "/admin/seasons/spring" })
	expect(result.props.cancelLabel).toBe("Close")
})
