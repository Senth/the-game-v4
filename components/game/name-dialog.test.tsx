import type { EffectCallback, ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { NameDialog, type SavePhoneName } from "./name-dialog"

const hooks = vi.hoisted(() => ({
	states: [] as unknown[],
	cursor: 0,
	setters: [] as ReturnType<typeof vi.fn>[],
	effects: [] as EffectCallback[],
	dialog: null as unknown,
}))

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: unknown) => {
		const index = hooks.cursor++
		const set = vi.fn()
		hooks.setters[index] = set
		return [hooks.states[index] ?? (typeof initial === "function" ? initial() : initial), set]
	},
	useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
	useRef: (initial: unknown) => ({ current: hooks.dialog ?? initial }),
	useId: () => "name-dialog-test",
}))
vi.mock("react-dom", () => ({ createPortal: (node: ReactElement) => node }))

const onClose = vi.fn()
const onSaveName = vi.fn<SavePhoneName>()
const props = { teamName: "Ninjas", name: "Quiet Fox", onClose, onSaveName }

function render(states: unknown[] = []) {
	hooks.states = states
	hooks.cursor = 0
	hooks.setters = []
	hooks.effects = []
	return renderToStaticMarkup(<NameDialog {...props} />)
}

function tree(states: unknown[] = []) {
	hooks.states = states
	hooks.cursor = 0
	hooks.setters = []
	return NameDialog(props) as ReactElement<{
		children: ReactElement<{ onSubmit: (event: { preventDefault: () => void }) => Promise<void> }>
	}>
}

beforeEach(() => {
	vi.clearAllMocks()
	hooks.dialog = null
	vi.stubGlobal("document", { body: {} })
})

afterEach(() => vi.unstubAllGlobals())

it("renders name field, helper and ranked actions", () => {
	const html = render()
	expect(html).toContain("Your name")
	expect(html).toContain('value="Quiet Fox"')
	expect(html).toContain("Only Ninjas and the game masters see it. Leave it empty for a random name.")
	expect(html).toContain(">Cancel</button>")
	expect(html).toContain(">Save</button>")
	expect(html).not.toContain("phone")
})

it.each([
	["taken", "Someone on Ninjas already uses that name."],
	["invalid", "Name must be 1–20 characters."],
] as const)("shows the %s name error", (error, copy) => {
	const html = render(["Quiet Fox", false, error])
	expect(html).toContain('role="alert"')
	expect(html).toContain(copy)
})

it("saves the current name and closes when accepted", async () => {
	const close = vi.fn()
	hooks.dialog = { close }
	onSaveName.mockResolvedValue({ phones: [{ name: "Quiet Fox", you: true }] })
	const dialog = tree()
	await dialog.props.children.props.onSubmit({ preventDefault: vi.fn() })
	expect(onSaveName).toHaveBeenCalledWith("Quiet Fox")
	expect(close).toHaveBeenCalledOnce()
})

it.each(["taken", "invalid"] as const)("keeps dialog open and reports rejected %s save", async (error) => {
	const close = vi.fn()
	hooks.dialog = { close }
	onSaveName.mockResolvedValue({ error })
	const dialog = tree()
	await dialog.props.children.props.onSubmit({ preventDefault: vi.fn() })
	expect(hooks.setters[2]).toHaveBeenCalledWith(error)
	expect(close).not.toHaveBeenCalled()
})
