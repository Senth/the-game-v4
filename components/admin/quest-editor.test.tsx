import { Children, cloneElement, type EffectCallback, isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { removeQuest } from "@/app/admin/tree-actions"
import { useAutosaveField, useAutosaveList } from "./autosave-provider"
import { ConfirmDialog } from "./confirm-dialog"
import { QuestEditor } from "./quest-editor"

const hooks = vi.hoisted(() => ({
	states: [] as unknown[],
	cursor: 0,
	refCursor: 0,
	effects: [] as EffectCallback[],
	push: vi.fn(),
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
	useId: () => "quest-title",
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: hooks.push }) }))
vi.mock("@/app/admin/tree-actions", () => ({ removeQuest: vi.fn() }))
vi.mock("./autosave-provider", () => ({ useAutosaveField: vi.fn(), useAutosaveList: vi.fn(), useAutosave: () => null }))
vi.mock("react-dom", () => ({ createPortal: (node: ReactNode) => node }))

const now = new Date("2026-10-12T17:00:00Z").getTime()
const defaults = {
	seasonId: "s1",
	arcId: "a1",
	quest: {
		id: "q1",
		displayTitle: "The map",
		internalTitle: "Harbour map",
		content: "Read the map",
		assetPath: "/assets/12345678-abcd.png",
		answers: ["harbour"],
		points: 10,
		adminNotes: "Bring a map",
	},
	start: null,
	end: null,
	now,
}
type ButtonProps = { children?: ReactNode; disabled?: boolean; className: string; onClick: () => void }
let cleanup: ReturnType<EffectCallback>

function buttons(node: ReactNode): ReactElement<ButtonProps>[] {
	return Children.toArray(node).flatMap((child) => {
		if (!isValidElement<ButtonProps>(child)) return []
		return child.type === "button" ? [child] : buttons(child.props.children)
	})
}

function render(props: Partial<Parameters<typeof QuestEditor>[0]> = {}) {
	hooks.cursor = 0
	hooks.refCursor = 0
	hooks.effects.length = 0
	const element = QuestEditor({ ...defaults, ...props })
	const children = element.props.children
	const dialog = ConfirmDialog(children[2].props)
	return {
		html: renderToStaticMarkup(cloneElement(element, {}, children[0], children[1], dialog)),
		fields: children[0].props.children[0].props.children,
		remove: buttons(children[1])[0],
		dialog,
		cancel: buttons(dialog)[0],
		confirm: buttons(dialog)[1],
	}
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.clearAllMocks()
	vi.stubGlobal("document", { body: {} })
	hooks.states.length = 0
	vi.mocked(removeQuest).mockReset().mockResolvedValue({ ok: true })
	vi.mocked(useAutosaveList).mockImplementation((_target, items) => ({
		items,
		add: vi.fn(),
		remove: vi.fn(),
		failed: false,
	}))
	vi.mocked(useAutosaveField).mockImplementation((_target, serverValue) => ({
		value: serverValue,
		onChange: vi.fn(),
		onFocus: vi.fn(),
		onBlur: vi.fn(),
		failed: false,
		error: undefined,
	}))
})
afterEach(() => {
	cleanup?.()
	cleanup = undefined
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

it("renders all seven fields in M2 order with helper text, desktop pairs and quiet removal", () => {
	const view = render()
	expect(view.html).toContain("Display title")
	expect(view.html).toContain("players see this")
	expect(view.html).toContain("Internal title")
	expect(view.html).toContain("admin only")
	expect(view.html).toContain("font-body normal-case tracking-normal")
	expect(view.html).toContain("space-y-5")
	const labels = ["Display title", "Internal title", "Content", "Image", "Answers", "Points", "Admin notes"]
	const positions = labels.map((label) => view.html.indexOf(`>${label}`))
	expect(positions.every((position) => position >= 0)).toBe(true)
	expect(positions).toEqual([...positions].sort((a, b) => a - b))
	expect(view.html.match(/admin only/g)).toHaveLength(2)
	expect(view.html).toContain("Markdown")
	expect(view.html).toContain("any match, case-insensitive")
	expect(view.html).toContain("max-w-2xl")
	expect(view.html.match(/lg:grid-cols-2 lg:gap-5/g)).toHaveLength(2)
	expect(view.html.match(/<input/g)).toHaveLength(4)
	expect(view.html).toMatch(/rows="5"[^>]*font-mono/)
	expect(view.html).toMatch(/rows="1"[^>]*font-body/)
	expect(view.html).toContain("mt-8 border-t border-z1")
	expect(view.remove?.props.className).toContain("min-h-11")
	expect(view.remove?.props.className).toContain("text-muted")
	expect(view.html).not.toContain("Save</button>")
	expect(useAutosaveField).toHaveBeenCalledWith({ arcId: "a1", questId: "q1", field: "displayTitle" }, "The map")
	expect(useAutosaveField).toHaveBeenCalledWith({ arcId: "a1", questId: "q1", field: "internalTitle" }, "Harbour map")
	expect(useAutosaveField).toHaveBeenCalledWith({ arcId: "a1", questId: "q1", field: "content" }, "Read the map")
	expect(useAutosaveField).toHaveBeenCalledWith({ arcId: "a1", questId: "q1", field: "adminNotes" }, "Bring a map")
	expect(useAutosaveField).toHaveBeenCalledWith({ arcId: "a1", questId: "q1", field: "points" }, 10)
	expect(useAutosaveList).toHaveBeenCalledWith({ arcId: "a1", questId: "q1", field: "answers" }, ["harbour"])
})

it("hides the read-only Image row when the quest has no asset", () => {
	const view = render({ quest: { ...defaults.quest, assetPath: null } })
	expect(view.html).not.toContain(">Image<")
	expect(view.html).not.toContain("<img")
	expect(view.html).toContain("Answers")
})

it.each([
	["", "", true],
	[" ", " ", true],
	["The map", "", false],
	["", "Harbour map", false],
])("autofocuses Display title only for unnamed quests %s / %s", (displayTitle, internalTitle, focused) => {
	const view = render({
		quest: { ...defaults.quest, displayTitle: displayTitle as string, internalTitle: internalTitle as string },
	})
	expect(view.fields[0].props.autoFocus).toBe(focused)
	expect(view.fields[1].props.autoFocus).toBeUndefined()
	expect(view.html.includes('autofocus=""')).toBe(focused)
})

it.each([null, new Date(now + 60_000)])(
	"confirms before removing in unstarted season %s and returns to Quests",
	async (start) => {
		const props = { start, end: start ? new Date(now + 3_660_000) : null }
		render(props).remove?.props.onClick()
		const view = render(props)
		expect(removeQuest).not.toHaveBeenCalled()
		expect(view.html).toContain("Remove Harbour map?")
		expect(view.html).toContain("Its answers and hints go too.")
		hooks.effects[1]?.()
		expect(hooks.showModal).toHaveBeenCalledOnce()
		expect(hooks.focus).toHaveBeenCalledOnce()
		view.confirm?.props.onClick()
		expect(hooks.close).toHaveBeenCalledOnce()
		await vi.waitFor(() => expect(removeQuest).toHaveBeenCalledWith("s1", "a1", "q1"))
		expect(hooks.push).toHaveBeenCalledWith("/admin/seasons/s1")
	},
)

it.each([
	["", "", "Remove this quest?"],
	["The map", " ", "Remove The map?"],
])("uses the matching removal label fallback", (displayTitle, internalTitle, title) => {
	const props = { quest: { ...defaults.quest, displayTitle, internalTitle } }
	render(props).remove?.props.onClick()
	expect(render(props).html).toContain(title)
})

it("cancels without calling removal", () => {
	render().remove?.props.onClick()
	const view = render()
	view.cancel?.props.onClick()
	expect(hooks.close).toHaveBeenCalledOnce()
	if (isValidElement<{ onClose: () => void }>(view.dialog)) view.dialog.props.onClose()
	expect(render().dialog).toBe(null)
	expect(removeQuest).not.toHaveBeenCalled()
	expect(hooks.push).not.toHaveBeenCalled()
})

it.each([now, now + 60_000])(
	"hides removal for ended or live season ending at %i but keeps all fields editable",
	(end) => {
		const view = render({ start: new Date(now - 60_000), end: new Date(end) })
		expect(view.remove).toBeUndefined()
		expect(view.html).not.toContain("Remove quest")
		expect(view.html.match(/<input/g)).toHaveLength(4)
		expect(view.html.match(/<textarea/g)).toHaveLength(2)
		expect(view.html).not.toContain("disabled")
		expect(view.html).not.toContain("readonly")
	},
)

it("hides removal and blocks already opened confirmation at start without reload", async () => {
	const props = { start: new Date(now + 1000), end: new Date(now + 60_000) }
	render(props).remove?.props.onClick()
	render(props)
	cleanup = hooks.effects[0]?.()
	await vi.advanceTimersByTimeAsync(1000)
	const view = render(props)
	expect(view.remove).toBeUndefined()
	expect(view.confirm?.props.disabled).toBe(true)
	view.confirm?.props.onClick()
	expect(removeQuest).not.toHaveBeenCalled()
})

it("disables repeated removal while pending, then shows the action failure below the control", async () => {
	let resolve!: (result: { ok: false; error: string }) => void
	vi.mocked(removeQuest).mockReturnValueOnce(
		new Promise((done) => {
			resolve = done
		}),
	)
	render().remove?.props.onClick()
	render().confirm?.props.onClick()
	const pending = render()
	expect(pending.remove?.props.disabled).toBe(true)
	expect(pending.confirm?.props.disabled).toBe(true)
	pending.confirm?.props.onClick()
	expect(removeQuest).toHaveBeenCalledOnce()
	resolve({ ok: false, error: "The game has started." })
	await vi.waitFor(() => expect(render().html).toContain("The game has started."))
	const failed = render()
	expect(failed.remove?.props.disabled).toBe(false)
	expect(failed.html).toContain('role="alert"')
	expect(failed.html).toContain("text-warn")
	expect(hooks.push).not.toHaveBeenCalled()
})

it("keeps the page on network failure and permits retry", async () => {
	vi.mocked(removeQuest).mockRejectedValueOnce(new Error("offline"))
	render().remove?.props.onClick()
	render().confirm?.props.onClick()
	await vi.waitFor(() => expect(render().html).toContain("Not saved, retry"))
	expect(hooks.push).not.toHaveBeenCalled()
	render().confirm?.props.onClick()
	await vi.waitFor(() => expect(hooks.push).toHaveBeenCalledWith("/admin/seasons/s1"))
})
