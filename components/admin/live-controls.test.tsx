import { Children, type EffectCallback, isValidElement, type ReactElement, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { endSeason, shiftSeasonEnd, startSeasonNow } from "@/app/admin/live-actions"
import { incompleteQuests } from "@/lib/domain/playable-quests"
import { newArc, newQuest } from "@/lib/domain/season-tree"
import { LiveControls } from "./live-controls"

const hooks = vi.hoisted(() => ({
	states: [] as unknown[],
	cursor: 0,
	refCursor: 0,
	effects: [] as EffectCallback[],
	showModal: vi.fn(),
	close: vi.fn(),
	focus: vi.fn(),
}))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: unknown) => {
		const index = hooks.cursor++
		if (!(index in hooks.states)) hooks.states[index] = initial
		return [
			hooks.states[index],
			(value: unknown) => {
				hooks.states[index] = value
			},
		]
	},
	useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
	useRef: () => ({
		current: hooks.refCursor++ === 0 ? { showModal: hooks.showModal, close: hooks.close } : { focus: hooks.focus },
	}),
	useId: () => "confirm-id",
}))
vi.mock("@/app/admin/live-actions", () => ({ startSeasonNow: vi.fn(), shiftSeasonEnd: vi.fn(), endSeason: vi.fn() }))
vi.mock("react-dom", () => ({ createPortal: vi.fn((node: ReactNode) => node) }))

const now = new Date("2026-10-12T17:00:00Z").getTime()
const defaults = { seasonId: "s1", start: null, end: null, now, teamCount: 10, hasQuests: true, incomplete: [] }
type ButtonProps = { children?: ReactNode; disabled?: boolean; className: string; onClick: () => void }
let cleanup: ReturnType<EffectCallback>

function buttons(node: ReactNode): ReactElement<ButtonProps>[] {
	return Children.toArray(node).flatMap((child) => {
		if (!isValidElement<ButtonProps>(child)) return []
		return child.type === "button" ? [child] : buttons(child.props.children)
	})
}

function render(props: Partial<Parameters<typeof LiveControls>[0]> = {}) {
	hooks.cursor = 0
	hooks.refCursor = 0
	hooks.effects.length = 0
	const element = LiveControls({ ...defaults, ...props })
	const strip = buttons(element.props.children[0])
	const dialog = element.props.children[3]
	function confirmationButton(index: number) {
		const button = buttons(dialog)[index]
		if (!button) throw new Error("Missing dialog buttons")
		return button
	}
	return {
		html: renderToStaticMarkup(element),
		strip,
		dialog,
		get cancel() {
			return confirmationButton(0)
		},
		get confirm() {
			return confirmationButton(1)
		},
		button(index: number) {
			const button = strip[index]
			if (!button) throw new Error(`Missing strip button ${index}`)
			return button
		},
	}
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(now + 3_600_000)
	vi.clearAllMocks()
	vi.stubGlobal("document", { body: {} })
	hooks.states.length = 0
	vi.mocked(startSeasonNow).mockResolvedValue({ ok: true })
	vi.mocked(shiftSeasonEnd).mockResolvedValue({ ok: true })
	vi.mocked(endSeason).mockResolvedValue({ ok: true })
})
afterEach(() => {
	cleanup?.()
	cleanup = undefined
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

it.each([null, new Date(now + 20_000)])("offers Start now before play, including upcoming %s", async (start) => {
	const view = render({ start, end: start ? new Date(now + 3_620_000) : null })
	expect(view.strip).toHaveLength(1)
	expect(view.html).not.toContain("<dialog")
	expect(view.button(0).props.children).toBe("Start now")
	expect(view.button(0).props.className).toContain("col-span-3")
	expect(view.button(0).props.className).toContain("h-11")
	expect(view.button(0).props.className).toContain("lg:h-9")
	expect(view.button(0).props.className).toContain("lg:after:-inset-y-1.5")
	view.button(0).props.onClick()
	await vi.waitFor(() => expect(startSeasonNow).toHaveBeenCalledWith("s1"))
})

it.each([
	{ count: 1, title: "Start with 1 incomplete quest?" },
	{ count: 2, title: "Start with 2 incomplete quests?" },
])("confirms Start now for $count incomplete quests", ({ count, title }) => {
	const incomplete = Array.from({ length: count }, (_, index) => ({
		id: `q${index + 1}`,
		label: `Quest ${index + 1}`,
		missing: ["answers"],
	}))
	render({ incomplete }).button(0).props.onClick()
	const view = render({ incomplete })
	expect(view.html).toContain(title)
	expect(view.html).toContain("Quest 1")
	expect(view.html).toContain('class="font-cond text-xs text-warn">answers</div>')
	expect(view.html).toContain("Teams get them as they are. A quest without answers can&#x27;t be solved.")
	expect(view.confirm.props.children).toBe("Start anyway")
	expect(view.confirm.props.className).toContain("bg-accent")
	expect(startSeasonNow).not.toHaveBeenCalled()
})

it("starts image-only quests without incomplete-quest confirmation", async () => {
	const quest = { ...newQuest(), assetPath: "/assets/clue.png", answers: ["clue"], points: 0 }
	const incomplete = incompleteQuests({ arcs: [{ ...newArc(false), quests: [quest] }] })
	const view = render({ incomplete })
	expect(view.html).not.toContain("<dialog")
	view.button(0).props.onClick()
	await vi.waitFor(() => expect(startSeasonNow).toHaveBeenCalledWith("s1"))
})

it("lists five incomplete quests then a muted remainder", () => {
	const incomplete = Array.from({ length: 7 }, (_, index) => ({
		id: `q${index + 1}`,
		label: `Quest ${index + 1}`,
		missing: ["content"],
	}))
	render({ incomplete }).button(0).props.onClick()
	const view = render({ incomplete })
	expect(view.html).toContain("Quest 5")
	expect(view.html).not.toContain("Quest 6")
	expect(view.html).toContain('class="font-cond text-xs text-muted">and 2 more</li>')
})

it("starts only after Start anyway and leaves start untouched on Cancel", async () => {
	const incomplete = [{ id: "q1", label: "Quest", missing: ["answers"] }]
	render({ incomplete }).button(0).props.onClick()
	const view = render({ incomplete })
	expect(view.cancel.props.children).toBe("Cancel")
	view.cancel.props.onClick()
	expect(startSeasonNow).not.toHaveBeenCalled()

	render({ incomplete }).button(0).props.onClick()
	render({ incomplete }).confirm.props.onClick()
	await vi.waitFor(() => expect(startSeasonNow).toHaveBeenCalledWith("s1"))
})

it("disables Start now without quests and shows muted exact helper", () => {
	const view = render({ hasQuests: false })
	expect(view.button(0).props.disabled).toBe(true)
	expect(view.html).toContain('class="mt-2 font-cond text-xs text-muted">Add a quest first.')
})

it.each([300_001, 300_000, 299_999])("enforces the −5 boundary with %i milliseconds left", (left) => {
	const view = render({ start: new Date(now - 1000), end: new Date(now + left) })
	expect(view.strip.map((button) => button.props.children)).toEqual(["−5 min", "+5 min", "End game"])
	expect(view.button(0).props.disabled).toBe(left <= 300_000)
	expect(view.button(1).props.className).toContain("border-z2")
	expect(view.button(2).props.className).toContain("border-pace-3")
})

it("expands bordered desktop targets beyond their padding box", () => {
	const view = render({ start: new Date(now), end: new Date(now + 600_000) })
	for (const button of view.strip) {
		expect(button.props.className).toContain("lg:after:-inset-y-1.5")
	}
})

it("mounts confirmation outside responsive frames only when opened", () => {
	const props = { start: new Date(now), end: new Date(now + 600_000) }
	const closed = render(props)
	expect(closed.html).not.toContain("<dialog")
	expect(createPortal).not.toHaveBeenCalled()
	closed.button(2).props.onClick()
	const opened = render(props)
	expect(createPortal).toHaveBeenCalledOnce()
	expect(vi.mocked(createPortal).mock.calls[0]?.[1]).toBe(document.body)
	expect(opened.html.match(/<dialog/g)).toHaveLength(1)
})

it("reserves mock A phone gutters and uses body font for confirmation prose", () => {
	const props = { start: new Date(now), end: new Date(now + 600_000) }
	render(props).button(2).props.onClick()
	const opened = render(props)
	expect(opened.html).toContain("w-[calc(100%-var(--spacing)*12)]")
	expect(opened.html).toContain('class="mt-2 font-body text-sm"')
})

it.each([-5, 5] as const)("calls the live shift action with %i", async (delta) => {
	const view = render({ start: new Date(now - 1000), end: new Date(now + 600_000) })
	view.button(delta === -5 ? 0 : 1).props.onClick()
	await vi.waitFor(() => expect(shiftSeasonEnd).toHaveBeenCalledWith("s1", delta))
})

it("offers only +5 min after end and reopens through the shift action", async () => {
	const view = render({ start: new Date(now - 600_000), end: new Date(now) })
	expect(view.strip).toHaveLength(1)
	expect(view.button(0).props.children).toBe("+5 min")
	view.button(0).props.onClick()
	await vi.waitFor(() => expect(shiftSeasonEnd).toHaveBeenCalledWith("s1", 5))
})

it.each([1, 10])("opens native confirmation with Cancel focused and correct copy for %i teams", (teamCount) => {
	const props = { start: new Date(now), end: new Date(now + 600_000), teamCount }
	render(props).button(2).props.onClick()
	const view = render(props)
	hooks.effects[1]?.()
	expect(hooks.showModal).toHaveBeenCalledOnce()
	expect(hooks.focus).toHaveBeenCalledOnce()
	expect(endSeason).not.toHaveBeenCalled()
	expect(view.html).toContain("End the game now?")
	expect(view.html).toContain(
		`All ${teamCount} ${teamCount === 1 ? "team sees its" : "teams see their"} final score. You can add 5 minutes afterwards.`,
	)
	expect(view.html).toContain("bg-z1")
	expect(view.confirm.props.className).toContain("bg-pace-3")
	view.cancel.props.onClick()
	expect(hooks.close).toHaveBeenCalledOnce()
	expect(endSeason).not.toHaveBeenCalled()
})

it("closes confirmation and calls End game only on confirm", async () => {
	const props = { start: new Date(now), end: new Date(now + 600_000) }
	render(props).button(2).props.onClick()
	const view = render(props)
	view.confirm.props.onClick()
	expect(hooks.close).toHaveBeenCalledOnce()
	await vi.waitFor(() => expect(endSeason).toHaveBeenCalledWith("s1"))
})

it("leaves Escape closing to native dialog cancellation rather than trapping keyboard input", () => {
	const props = { start: new Date(now), end: new Date(now + 600_000) }
	render(props).button(2).props.onClick()
	const dialog = render(props).dialog
	expect(dialog.type).toBe("dialog")
	expect(dialog.props.onCancel).toBeUndefined()
	expect(dialog.props.onKeyDown).toBeUndefined()
	dialog.props.onClose()
	expect(render(props).html).not.toContain("<dialog")
	render(props).button(2).props.onClick()
	expect(render(props).html.match(/<dialog/g)).toHaveLength(1)
})

it("disables all live buttons while pending, shows one warning then clears it on retry", async () => {
	let resolve!: (value: { ok: false; error: string }) => void
	vi.mocked(shiftSeasonEnd).mockReturnValueOnce(
		new Promise((done) => {
			resolve = done
		}),
	)
	const props = { start: new Date(now), end: new Date(now + 600_000) }
	render(props).button(2).props.onClick()
	render(props).button(1).props.onClick()
	const pending = render(props)
	expect(pending.strip.every((button) => button.props.disabled)).toBe(true)
	expect(pending.confirm.props.disabled).toBe(true)
	resolve({ ok: false, error: '"Spring Hunt" is live. End it first.' })
	await vi.waitFor(() => expect(render(props).html).toContain("Spring Hunt"))
	const failed = render(props)
	expect(failed.html.match(/role="alert"/g)).toHaveLength(1)
	expect(failed.html).toContain("text-warn")
	expect(failed.button(1).props.disabled).toBe(false)
	failed.button(1).props.onClick()
	await vi.waitFor(() => expect(render(props).html).not.toContain("Spring Hunt"))
})

it("restores buttons and reports failed network requests", async () => {
	vi.mocked(startSeasonNow).mockRejectedValueOnce(new Error("offline"))
	render().button(0).props.onClick()
	await vi.waitFor(() => expect(render().html).toContain("Not saved, retry"))
	expect(render().button(0).props.disabled).toBe(false)
})

it("ticks from upcoming through live, the shrink boundary and ended without reload", async () => {
	const props = { start: new Date(now + 1000), end: new Date(now + 302_000) }
	expect(render(props).button(0).props.children).toBe("Start now")
	cleanup = hooks.effects[0]?.()
	await vi.advanceTimersByTimeAsync(1000)
	expect(render(props).button(0).props.disabled).toBe(false)
	expect(render(props).button(0).props.children).toBe("−5 min")
	await vi.advanceTimersByTimeAsync(1000)
	expect(render(props).button(0).props.disabled).toBe(true)
	await vi.advanceTimersByTimeAsync(300_000)
	expect(render(props).strip.map((button) => button.props.children)).toEqual(["+5 min"])
	expect(vi.getTimerCount()).toBe(0)
})
