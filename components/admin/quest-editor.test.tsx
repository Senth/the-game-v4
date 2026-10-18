import {
	Children,
	cloneElement,
	type EffectCallback,
	isValidElement,
	type ReactElement,
	type ReactNode,
	useEffect,
	useState,
} from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { uploadQuestAsset } from "@/app/admin/asset-actions"
import { addQuestToGame, getAddQuestImpact, getRemoveQuestImpact, removeQuest } from "@/app/admin/tree-actions"
import { useAutosaveField, useAutosaveList } from "./autosave-provider"
import { ConfirmDialog } from "./confirm-dialog"
import { CopyDialog } from "./copy-dialog"
import { QuestEditor } from "./quest-editor"

const hooks = vi.hoisted(() => ({
	states: [] as unknown[],
	cursor: 0,
	refCursor: 0,
	refs: [] as { current: unknown }[],
	effects: [] as EffectCallback[],
	push: vi.fn(),
	showModal: vi.fn(),
	close: vi.fn(),
	focus: vi.fn(),
	copyDialog: vi.fn(() => null),
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
	useRef: (initial: unknown) => {
		const index = hooks.refCursor++
		hooks.refs[index] ??= {
			current: initial === null ? { showModal: hooks.showModal, close: hooks.close, focus: hooks.focus } : initial,
		}
		return hooks.refs[index]
	},
	useImperativeHandle: (ref: { current: unknown }, create: () => unknown) => {
		ref.current = create()
	},
	useId: () => "quest-title",
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: hooks.push }) }))
vi.mock("./copy-dialog", () => ({ CopyDialog: hooks.copyDialog }))
vi.mock("@/app/admin/tree-actions", () => ({
	addQuestToGame: vi.fn(),
	getAddQuestImpact: vi.fn(),
	getRemoveQuestImpact: vi.fn(),
	removeQuest: vi.fn(),
}))
vi.mock("@/app/admin/asset-actions", () => ({ uploadQuestAsset: vi.fn(), removeQuestAsset: vi.fn() }))
vi.mock("./autosave-provider", () => ({
	useAutosaveField: vi.fn(),
	useAutosaveList: vi.fn(),
	useAutosave: () => null,
	useAssetDraft: (_target: unknown, serverValue: string | null) => {
		const [value, onChange] = useState(serverValue)
		useEffect(() => onChange(serverValue), [serverValue])
		return { value, onChange }
	},
}))
vi.mock("react-dom", () => ({ createPortal: (node: ReactNode) => node }))

const now = new Date("2026-10-12T17:00:00Z").getTime()
const defaults = {
	seasonId: "s1",
	seasonTitle: "Cipher Night 2026",
	arcId: "a1",
	arcTitle: "Lighthouse",
	hintCount: 1,
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
const live = { start: new Date(now - 60_000), end: new Date(now + 60_000) }
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
	const content = Children.toArray(children[0].props.children)
	const offset = props.quest?.hidden ? 1 : 0
	const fields = content[offset] as ReactElement<{ children: ReactNode }>
	const dialog = ConfirmDialog(children[2].props)
	const controls = buttons(children[1])
	return {
		html: renderToStaticMarkup(cloneElement(element, {}, children[0], children[1], dialog, children[3], children[4])),
		root: element,
		asset: content[offset + 2] as ReactElement<{ assetPath: string | null; onChange: (path: string | null) => void }>,
		fields: Children.toArray(fields.props.children) as ReactElement<{ autoFocus?: boolean }>[],
		copy: controls.find((button) => button.props.children === "Copy to another season…"),
		remove: controls.find((button) => button.props.children === "Remove quest"),
		add: buttons(children[0]).find((button) => button.props.children === "Add to game"),
		dialog,
		cancel: buttons(dialog)[0],
		confirm: buttons(dialog)[1],
		copyDialogProps: vi.mocked(CopyDialog).mock.lastCall?.[0],
	}
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.clearAllMocks()
	vi.stubGlobal("document", { body: {} })
	hooks.states.length = 0
	hooks.refs.length = 0
	vi.mocked(uploadQuestAsset).mockReset().mockResolvedValue({ ok: true, assetPath: "/assets/new-image.png" })
	vi.mocked(removeQuest).mockReset().mockResolvedValue({ ok: true })
	vi.mocked(addQuestToGame).mockReset().mockResolvedValue({ ok: true })
	vi.mocked(getAddQuestImpact)
		.mockReset()
		.mockResolvedValue({
			ok: true,
			impact: { kind: "addQuest", added: ["Ninjas", "Lagom"], completed: 3 },
		})
	vi.mocked(getRemoveQuestImpact)
		.mockReset()
		.mockResolvedValue({
			ok: true,
			impact: { kind: "deleteQuest", onIt: ["Ninjas"], notReached: ["Lagom"], solved: 4 },
		})
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
	expect(view.html.match(/<input/g)).toHaveLength(5)
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

it.each([
	["unscheduled", { start: null, end: null }],
	["upcoming", { start: new Date(now + 60_000), end: new Date(now + 3_660_000) }],
	["live", live],
	["ended", { start: new Date(now - 60_000), end: new Date(now) }],
])("offers quest copying in %s seasons", (_state, timing) => {
	const view = render(timing)
	expect(view.copy).toBeDefined()
	if (view.remove) expect(view.html.indexOf("Copy to another season…")).toBeLessThan(view.html.indexOf("Remove quest"))
	view.copy?.props.onClick()
	const opened = render(timing)
	expect(opened.copyDialogProps).toMatchObject({
		open: true,
		mode: "quest",
		sourceSeasonId: "s1",
		sourceSeasonTitle: "Cipher Night 2026",
		sourceArc: { id: "a1", title: "Lighthouse" },
		quest: { id: "q1", label: "Harbour map", hintCount: 1 },
	})
})

it("shows missing draft fields above Display title and disables Add to game", () => {
	const view = render({
		...live,
		quest: { ...defaults.quest, hidden: true, displayTitle: "", content: "", answers: [], points: null },
	})
	expect(view.html).toContain("Fill in display title, content, answers and points to add it to the game.")
	expect(view.html).toContain("bg-z1 rounded-md p-3")
	expect(view.html.indexOf("Fill in display title")).toBeLessThan(view.html.indexOf(">Display title"))
	expect(view.add?.props.disabled).toBe(true)
})

it.each([
	["unscheduled", { start: null, end: null }],
	["upcoming", { start: new Date(now + 60_000), end: new Date(now + 3_660_000) }],
	["live", live],
	["ended", { start: new Date(now - 60_000), end: new Date(now) }],
])("warns on all four missing fields from first open in %s seasons, including drafts", (_state, timing) => {
	for (const hidden of [false, true]) {
		const view = render({
			...timing,
			quest: { ...defaults.quest, hidden, displayTitle: " \n ", content: "", answers: [], points: null },
		})
		for (const message of ["Needs a display title", "Needs content", "Needs an answer", "Needs points"]) {
			expect(view.html).toContain(message)
		}
		expect(view.html.match(/-missing" class="mt-1.5 font-cond text-xs text-warn"/g)).toHaveLength(4)
		expect(view.html).not.toContain("aria-invalid")
		expect(view.html).not.toContain('role="alert"')
	}
})

it("keeps complete quests quiet, including zero points", () => {
	const view = render({ quest: { ...defaults.quest, points: 0 } })
	expect(view.html).not.toContain("Needs ")
	expect(view.html).not.toContain("-missing")
	expect(view.html).not.toContain("border-warn")
})

it("shows ready draft copy and enables Add to game", () => {
	const view = render({ ...live, quest: { ...defaults.quest, hidden: true } })
	expect(view.html).toContain("Teams don&#x27;t see this quest yet.")
	expect(view.add?.props.disabled).toBe(false)
	expect(view.add?.props.className).toContain("bg-accent")
})

it("loads Add to game counts and confirms completed teams in dialog", async () => {
	const props = { ...live, quest: { ...defaults.quest, hidden: true } }
	render(props).add?.props.onClick()
	render(props)
	for (const effect of hooks.effects) effect()
	expect(getAddQuestImpact).toHaveBeenCalledWith("s1", "a1", "q1")
	const loading = render(props)
	expect(loading.html).toContain("Counting teams…")
	expect(loading.confirm?.props.disabled).toBe(true)
	await vi.waitFor(() => expect(render(props).html).toContain("Add Harbour map for 2 teams?"))
	const dialog = render(props)
	expect(dialog.html).toContain("Each team gets it at a random spot after its current quest.")
	expect(dialog.html).toContain("3 teams finished and don&#x27;t get it.")
	expect(dialog.html).not.toContain("Counting teams…")
	expect(dialog.confirm?.props.className).toContain("bg-accent")
	expect(dialog.confirm?.props.disabled).toBe(false)
	dialog.confirm?.props.onClick()
	await vi.waitFor(() => expect(addQuestToGame).toHaveBeenCalledWith("s1", "a1", "q1"))
	expect(render({ ...live, quest: { ...defaults.quest, hidden: false } }).html).not.toContain(
		"Teams don&#x27;t see this quest yet.",
	)
})

it("uses the no-team Add to game title and body", async () => {
	const props = { ...live, quest: { ...defaults.quest, hidden: true } }
	vi.mocked(getAddQuestImpact).mockResolvedValueOnce({
		ok: true,
		impact: { kind: "addQuest", added: [], completed: 0 },
	})
	render(props).add?.props.onClick()
	render(props)
	for (const effect of hooks.effects) effect()
	await vi.waitFor(() => expect(render(props).html).toContain("Add Harbour map to the game?"))
	const dialog = render(props)
	expect(dialog.html).toContain("No team is playing it yet. Teams that start later get it.")
	expect(dialog.html).not.toContain("teams finished")
})

it("confirms live quest removal with shared impact body", async () => {
	const props = { ...live, quest: { ...defaults.quest, hidden: false } }
	render(props).remove?.props.onClick()
	render(props)
	for (const effect of hooks.effects) effect()
	expect(getRemoveQuestImpact).toHaveBeenCalledWith("s1", "a1", "q1")
	await vi.waitFor(() => expect(render(props).html).toContain("2 teams affected"))
	const dialog = render(props)
	expect(dialog.html).toContain("Remove Harbour map?")
	expect(dialog.html).toContain("On it now · skips it with 0 points")
	expect(dialog.html).toContain("Not reached · leaves their order")
	expect(dialog.html).toContain("4 teams solved it and keep their points.")
	expect(dialog.html).not.toContain("Its answers, hints and image go too.")
	expect(dialog.confirm?.props.className).toContain("bg-pace-3")
	dialog.confirm?.props.onClick()
	await vi.waitFor(() => expect(removeQuest).toHaveBeenCalledWith("s1", "a1", "q1"))
})

it("keeps live draft removal confirmation plain", () => {
	const props = { ...live, quest: { ...defaults.quest, hidden: true } }
	render(props).remove?.props.onClick()
	const dialog = render(props)
	expect(dialog.html).toContain("Its answers, hints and image go too.")
	expect(dialog.html).not.toContain("Counting teams…")
	expect(getRemoveQuestImpact).not.toHaveBeenCalled()
})

it("shows Upload and empty Image row when the quest has no asset", () => {
	const view = render({ quest: { ...defaults.quest, assetPath: null } })
	expect(view.html).toContain(">Image")
	expect(view.html).not.toContain("<img")
	expect(view.html).toContain("Upload</button>")
	expect(view.html).toContain("No image")
	expect(view.html).toContain("Answers")
})

it("places Hints after Admin notes and before Remove quest without adding them to the quest prop", () => {
	const view = render({ children: <section aria-label="Hints">Hints section</section> })
	expect(view.html.indexOf("Admin notes")).toBeLessThan(view.html.indexOf("Hints section"))
	expect(view.html.indexOf("Hints section")).toBeLessThan(view.html.indexOf("Remove quest"))
})

function drag(files: File[] = [], types = ["Files"]) {
	return { dataTransfer: { types, files, dropEffect: "none" }, preventDefault: vi.fn() }
}

it.each([null, defaults.quest.assetPath])(
	"shows matching desktop overlay while file drag is over form, asset=%s",
	(assetPath) => {
		const props = { quest: { ...defaults.quest, assetPath } }
		const event = drag()
		render(props).root.props.onDragEnter(event)
		const view = render(props)
		expect(view.html).toContain(assetPath ? "Drop to replace the image" : "Drop to add an image or PDF")
		expect(view.html).toContain("absolute inset-0")
		expect(view.html).toContain("border-2 border-dashed border-accent bg-z0/85")
		expect(view.html).toContain("lg:flex")
		view.root.props.onDragEnter(event)
		render(props).root.props.onDragLeave(event)
		expect(render(props).html).toContain("Drop to")
		render(props).root.props.onDragLeave(event)
		expect(render(props).html).not.toContain("Drop to")
	},
)

it("leaves text drags and drops alone without an overlay", () => {
	const event = drag([], ["text/plain"])
	const root = render().root
	root.props.onDragEnter(event)
	root.props.onDragOver(event)
	root.props.onDrop(event)
	expect(render().html).not.toContain("Drop to")
	expect(event.preventDefault).not.toHaveBeenCalled()
	expect(uploadQuestAsset).not.toHaveBeenCalled()
})

it("rejects multiple files in Image row error slot and resets overlay", () => {
	const event = drag([new File(["a"], "a.png"), new File(["b"], "b.pdf")])
	render().root.props.onDragEnter(event)
	render().root.props.onDrop(event)
	const view = render()
	expect(event.preventDefault).toHaveBeenCalled()
	expect(view.html).not.toContain("Drop to")
	expect(view.html).toContain('role="alert"')
	expect(view.html).toContain("Drop one file at a time.")
	expect(uploadQuestAsset).not.toHaveBeenCalled()
})

it("accepts a file drop bubbled from Content, uploads once and updates Image row without reload", async () => {
	const file = new File(["png"], "map.png")
	const event = drag([file])
	render().root.props.onDragEnter(event)
	render().root.props.onDragOver(event)
	expect(event.dataTransfer.dropEffect).toBe("copy")
	render().root.props.onDrop(event)
	await vi.waitFor(() => expect(render().html).toContain('src="/assets/new-image.png"'))
	expect(event.preventDefault).toHaveBeenCalled()
	expect(uploadQuestAsset).toHaveBeenCalledOnce()
	expect(vi.mocked(uploadQuestAsset).mock.calls[0]?.slice(0, 3)).toEqual(["s1", "a1", "q1"])
	expect(render().html).not.toContain("Drop to")
})

it.each([null, defaults.quest.assetPath])("changes Remove quest copy with current file, asset=%s", (assetPath) => {
	const props = { quest: { ...defaults.quest, assetPath } }
	render(props).remove?.props.onClick()
	expect(render(props).html).toContain(
		assetPath ? "Its answers, hints and image go too." : "Its answers and hints go too.",
	)
	render(props).asset.props.onChange(assetPath ? null : "/assets/new.png")
	expect(render(props).html).toContain(
		assetPath ? "Its answers and hints go too." : "Its answers, hints and image go too.",
	)
})

it("syncs Image row from refreshed server props after another admin changes asset", () => {
	render()
	const props = { quest: { ...defaults.quest, assetPath: "/assets/another-admin.pdf" } }
	render(props)
	hooks.effects[1]?.()
	expect(render(props).asset.props.assetPath).toBe("/assets/another-admin.pdf")
	const removed = { quest: { ...defaults.quest, assetPath: null } }
	render(removed)
	hooks.effects[1]?.()
	expect(render(removed).html).toContain("No image")
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
	expect(view.fields[0]?.props.autoFocus).toBe(focused)
	expect(view.fields[1]?.props.autoFocus).toBeUndefined()
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
		expect(view.html).toContain("Its answers, hints and image go too.")
		for (const effect of hooks.effects) effect()
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

it.each(["live", "ended"] as const)("shows removal only while live and keeps all fields editable: %s", (state) => {
	const end = new Date(state === "ended" ? now : now + 60_000)
	const view = render({ start: new Date(now - 60_000), end })
	if (state === "live") expect(view.remove).toBeDefined()
	else {
		expect(view.remove).toBeUndefined()
		expect(view.html).not.toContain("Remove quest")
	}
	expect(view.html.match(/<input/g)).toHaveLength(5)
	expect(view.html.match(/<textarea/g)).toHaveLength(2)
	expect(view.html).not.toContain('disabled=""')
	expect(view.html).not.toContain('readonly=""')
})

it("keeps removal visible and loads impact for an open confirmation at start", async () => {
	const props = { start: new Date(now + 1000), end: new Date(now + 60_000) }
	render(props).remove?.props.onClick()
	render(props)
	cleanup = hooks.effects[0]?.()
	await vi.advanceTimersByTimeAsync(1000)
	const view = render(props)
	expect(view.remove).toBeDefined()
	expect(view.confirm?.props.disabled).toBe(true)
	expect(view.html).toContain("Counting teams…")
	hooks.effects[2]?.()
	expect(getRemoveQuestImpact).toHaveBeenCalledWith("s1", "a1", "q1")
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
