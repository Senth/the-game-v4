import type { EffectCallback, ReactElement, ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, type Mock, vi } from "vitest"
import { getJoinQr } from "@/app/actions"
import { InviteDialog } from "./invite-dialog"
import { TeamMenu } from "./team-menu"

type Qr = Awaited<ReturnType<typeof getJoinQr>>
const onePhone = [{ name: "Quiet Fox", you: true }]
const savePhoneName = vi.fn()

const hooks = vi.hoisted(() => ({
	states: [] as unknown[],
	cursor: 0,
	setters: [] as Mock[],
	effects: [] as EffectCallback[],
	dialog: null as unknown,
}))

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: unknown) => {
		const set = vi.fn()
		hooks.setters.push(set)
		return [hooks.states[hooks.cursor++] ?? initial, set]
	},
	useEffect: (effect: EffectCallback) => {
		hooks.effects.push(effect)
	},
	useRef: (initial: unknown) => ({ current: initial ?? hooks.dialog }),
	useId: () => "team-menu-test",
}))
vi.mock("react-dom", () => ({ createPortal: (node: ReactNode) => node }))
vi.mock("@/app/actions", () => ({ getJoinQr: vi.fn() }))

function render(node: ReactNode, ...states: unknown[]) {
	hooks.states = states
	hooks.cursor = 0
	hooks.setters = []
	hooks.effects = []
	return renderToStaticMarkup(node)
}

beforeEach(() => vi.stubGlobal("document", { body: {} }))
afterEach(() => {
	hooks.dialog = null
	vi.unstubAllGlobals()
})

it("renders a closed ⋮ button that announces its menu", () => {
	const html = render(<TeamMenu teamName="Ninjas" phones={onePhone} savePhoneName={savePhoneName} />)
	expect(html).toMatch(/<button[^>]*aria-label="Team menu"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/)
	expect(html).not.toContain('role="menu"')
	expect(html).not.toContain("<dialog")
})

it("opens with invite and name rows plus one teammate", () => {
	const html = render(<TeamMenu teamName="Ninjas" phones={onePhone} savePhoneName={savePhoneName} />, true, null)
	expect(html).toContain('aria-expanded="true"')
	expect(html).toMatch(/role="menu"[^>]*><p[^>]*>Ninjas<\/p>/)
	expect(html.match(/role="menuitem"/g)).toHaveLength(2)
	expect(html).toMatch(/role="menuitem"[^>]*>Invite a teammate</)
	expect(html).toContain("Quiet Fox")
	expect(html).toContain("(you)")
	expect(html).toContain("On this team")
	expect(html.indexOf("Invite a teammate")).toBeLessThan(html.indexOf("Your name"))
	expect(html.indexOf("Your name")).toBeLessThan(html.indexOf("On this team"))
})

it("lists several teammates in order and marks only your name", () => {
	const phones = [
		{ name: "Quiet Fox", you: true },
		{ name: "Ben", you: false },
		{ name: "Kim", you: false },
		{ name: "Brave Owl", you: false },
	]
	const html = render(<TeamMenu teamName="Ninjas" phones={phones} savePhoneName={savePhoneName} />, true, null)
	const positions = ["Quiet Fox", "(you)", "Ben", "Kim", "Brave Owl"].map((name) => html.indexOf(name))
	expect(positions.every((position) => position >= 0)).toBe(true)
	expect(positions).toEqual([...positions].sort((a, b) => a - b))
})

it("opens the name dialog from the Your name menu row", () => {
	hooks.states = [true, null]
	hooks.cursor = 0
	hooks.setters = []
	const menu = TeamMenu({ teamName: "Ninjas", phones: onePhone, savePhoneName }) as ReactElement<{
		children: [ReactElement, ReactElement<{ children: ReactElement[] }>]
	}>
	const nameButton = menu.props.children[1].props.children[2] as ReactElement<{ onClick: () => void }>
	nameButton.props.onClick()
	expect(hooks.setters[0]).toHaveBeenCalledWith(false)
	expect(hooks.setters[1]).toHaveBeenCalledWith("name")
})

it("closes on an outside click after default focus and returns focus to ⋮", () => {
	const listeners = new Map<string, (event: Partial<MouseEvent>) => void>()
	const focus = vi.fn()
	vi.stubGlobal("document", {
		addEventListener: (type: string, listener: (event: Partial<MouseEvent>) => void) => listeners.set(type, listener),
		removeEventListener: vi.fn(),
	})
	hooks.dialog = { focus, contains: () => false }

	render(<TeamMenu teamName="Ninjas" phones={onePhone} savePhoneName={savePhoneName} />, true, null)
	const [setOpen] = hooks.setters
	hooks.effects[0]?.()
	expect(listeners.has("pointerdown")).toBe(false)

	listeners.get("click")?.({ target: {} as EventTarget })
	expect(setOpen).toHaveBeenCalledWith(false)
	expect(focus).toHaveBeenCalledTimes(2)
})

it("shows a loading placeholder, then the code with Copy link and Close and no toggle", () => {
	const loading = render(<InviteDialog onClose={vi.fn()} />)
	expect(loading).toContain("Invite a teammate")
	expect(loading).toContain("Loading…")
	expect(loading).not.toContain("<img")

	const html = render(<InviteDialog onClose={vi.fn()} />, { url: "https://game.example/join/t", svg: "<svg/>" })
	expect(html).toContain("QR code to log in to your team")
	expect(html).toContain("Teammates scan this to log in.")
	expect(html.indexOf("Copy link")).toBeLessThan(html.indexOf("Close"))
	expect(html).not.toContain("Hide QR code")
	expect(html).not.toContain("Show QR code")
})

it("offers a retry when the code cannot load", () => {
	const html = render(<InviteDialog onClose={vi.fn()} />, "failed")
	expect(html).toContain("Could not load the code. Try again.")
	expect(html).toContain(">Try again</button>")
	expect(html).not.toContain("Loading…")
})

it("mounts a fresh loading dialog for each invitation", () => {
	const html = render(<TeamMenu teamName="Ninjas" phones={onePhone} savePhoneName={savePhoneName} />, false, "invite")
	expect(html).toContain("<dialog")
	expect(html).toContain("Loading…")
})

it("drops a code that arrives after its invitation closed", async () => {
	const stale = Promise.withResolvers<Qr>()
	const fresh = Promise.withResolvers<Qr>()
	const oldQr = { url: "https://game.example/join/old", svg: "<svg/>" }
	const newQr = { url: "https://game.example/join/new", svg: "<svg/>" }
	vi.mocked(getJoinQr).mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise)
	hooks.dialog = { showModal: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }

	render(<InviteDialog onClose={vi.fn()} />)
	const [setFirst] = hooks.setters
	const close = hooks.effects[0]?.()
	if (close) close()

	expect(render(<InviteDialog onClose={vi.fn()} />)).toContain("Loading…")
	const [setSecond] = hooks.setters
	hooks.effects[0]?.()

	stale.resolve(oldQr)
	await stale.promise
	expect(setFirst).not.toHaveBeenCalledWith(oldQr)
	expect(setSecond).not.toHaveBeenCalledWith(oldQr)

	fresh.resolve(newQr)
	await fresh.promise
	expect(setSecond).toHaveBeenCalledWith(newQr)
})
