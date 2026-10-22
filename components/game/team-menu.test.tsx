import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { InviteDialog } from "./invite-dialog"
import { TeamMenu } from "./team-menu"

const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0 }))

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: unknown) => [hooks.states[hooks.cursor++] ?? initial, vi.fn()],
}))
vi.mock("react-dom", () => ({ createPortal: (node: ReactNode) => node }))
vi.mock("@/app/actions", () => ({ getJoinQr: vi.fn() }))

function render(node: ReactNode, ...states: unknown[]) {
	hooks.states = states
	hooks.cursor = 0
	return renderToStaticMarkup(node)
}

beforeEach(() => vi.stubGlobal("document", { body: {} }))
afterEach(() => vi.unstubAllGlobals())

it("renders a closed ⋮ button that announces its menu", () => {
	const html = render(<TeamMenu teamName="Ninjas" />)
	expect(html).toMatch(/<button[^>]*aria-label="Team menu"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/)
	expect(html).not.toContain('role="menu"')
	expect(html).not.toContain("<dialog")
})

it("opens with the team name heading and one invite item", () => {
	const html = render(<TeamMenu teamName="Ninjas" />, true)
	expect(html).toContain('aria-expanded="true"')
	expect(html).toMatch(/role="menu"[^>]*><p[^>]*>Ninjas<\/p>/)
	expect(html.match(/role="menuitem"/g)).toHaveLength(1)
	expect(html).toMatch(/role="menuitem"[^>]*>Invite a teammate</)
})

it("shows a loading placeholder, then the code with Copy link and Close and no toggle", () => {
	const loading = render(<InviteDialog open onClose={vi.fn()} />)
	expect(loading).toContain("Invite a teammate")
	expect(loading).toContain("Loading…")
	expect(loading).not.toContain("<img")

	const html = render(<InviteDialog open onClose={vi.fn()} />, { url: "https://game.example/join/t", svg: "<svg/>" })
	expect(html).toContain("QR code to log in to your team")
	expect(html).toContain("Teammates scan this to log in.")
	expect(html.indexOf("Copy link")).toBeLessThan(html.indexOf("Close"))
	expect(html).not.toContain("Hide QR code")
	expect(html).not.toContain("Show QR code")
})

it("offers a retry when the code cannot load", () => {
	const html = render(<InviteDialog open onClose={vi.fn()} />, "failed")
	expect(html).toContain("Could not load the code. Try again.")
	expect(html).toContain(">Try again</button>")
	expect(html).not.toContain("Loading…")
})

it("renders nothing while closed", () => {
	expect(render(<InviteDialog open={false} onClose={vi.fn()} />)).toBe("")
})
