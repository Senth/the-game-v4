import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { TeamPhones } from "./team-phones"

const hooks = vi.hoisted(() => ({ effects: [] as EffectCallback[], router: { refresh: vi.fn() } }))
vi.mock("next/navigation", () => ({ useRouter: () => hooks.router }))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
}))

const now = new Date("2026-10-28T17:00:00Z")
const phones = [
	{ name: "Quiet Fox", lastSeenAt: new Date(now.getTime() - 1_000) },
	{ name: "Brave Owl", lastSeenAt: new Date(now.getTime() - 600_001) },
	{ name: "Ben", lastSeenAt: now },
	{ name: "Kim", lastSeenAt: new Date(now.getTime() - 600_000) },
]

let cleanup: (() => void)[] = []

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(now)
	vi.clearAllMocks()
	hooks.effects = []
	cleanup = []
	vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }))
})

afterEach(() => {
	for (const stop of cleanup) stop()
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

function mount(snapshot = [{ name: "Quiet Fox", lastSeenAt: now }]) {
	let html = ""
	const render = () => {
		html = renderToStaticMarkup(<TeamPhones phones={snapshot} now={new Date()} />)
	}
	hooks.router.refresh.mockImplementation(render)
	render()
	cleanup = hooks.effects.map((effect) => effect()).filter((stop): stop is () => void => !!stop)
	return { html: () => html }
}

function visible(hidden: boolean) {
	Object.assign(document, { hidden })
	document.dispatchEvent(new Event("visibilitychange"))
}

it("refreshes an idle visible view past the ten-minute edge without mutation events", async () => {
	const view = mount()
	await vi.advanceTimersByTimeAsync(600_000)
	expect(view.html()).not.toContain("Quiet Fox away")
	await vi.advanceTimersByTimeAsync(60_000)
	expect(hooks.router.refresh).toHaveBeenCalled()
	expect(view.html()).toContain("Quiet Fox away")
})

it("recognizes a heartbeat-only return on the next snapshot", async () => {
	const phone = { name: "Quiet Fox", lastSeenAt: new Date(now.getTime() - 660_000) }
	const view = mount([phone])
	expect(view.html()).toContain("Quiet Fox away")
	phone.lastSeenAt = new Date()
	await vi.advanceTimersByTimeAsync(60_000)
	expect(hooks.router.refresh).toHaveBeenCalledOnce()
	expect(view.html()).not.toContain("Quiet Fox away")
})

it("pauses hidden snapshots, refreshes on return and cleans up on unmount", async () => {
	visible(true)
	mount()
	await vi.advanceTimersByTimeAsync(120_000)
	expect(hooks.router.refresh).not.toHaveBeenCalled()
	visible(false)
	expect(hooks.router.refresh).toHaveBeenCalledOnce()
	for (const stop of cleanup) stop()
	cleanup = []
	await vi.advanceTimersByTimeAsync(120_000)
	visible(true)
	visible(false)
	expect(hooks.router.refresh).toHaveBeenCalledOnce()
})

it("lists here phones first by name, then marks away phones muted", () => {
	const html = renderToStaticMarkup(<TeamPhones phones={phones} now={now} />)

	expect(html.indexOf("Ben")).toBeLessThan(html.indexOf("Kim"))
	expect(html.indexOf("Kim")).toBeLessThan(html.indexOf("Quiet Fox"))
	expect(html.indexOf("Quiet Fox")).toBeLessThan(html.indexOf("Brave Owl away"))
	expect(html).toContain('<span class="text-muted">Brave Owl away</span>')
	expect(html).not.toContain('class="text-muted">Kim')
})

it("shows muted phone count", () => {
	const html = renderToStaticMarkup(<TeamPhones phones={phones} now={now} />)

	expect(html).toContain('<span class="font-cond text-xs text-muted">4 phones</span>')
})

it("shows quiet empty state", () => {
	const html = renderToStaticMarkup(<TeamPhones phones={[]} now={now} />)

	expect(html).toContain("No phones yet")
	expect(html).toContain("0 phones")
})
