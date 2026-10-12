import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { setSeasonRegistration } from "@/app/admin/live-actions"
import { useAutosaveField } from "./autosave-provider"
import { SeasonSwitch } from "./autosave-switch"
import { RegistrationSwitch } from "./registration-switch"

const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0, effects: [] as EffectCallback[] }))
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
	useId: () => "registration",
}))
vi.mock("@/app/admin/live-actions", () => ({ setSeasonRegistration: vi.fn() }))
vi.mock("./autosave-provider", () => ({ useAutosaveField: vi.fn() }))

function render(serverValue = false) {
	hooks.cursor = 0
	hooks.effects.length = 0
	const element = RegistrationSwitch({ seasonId: "s1", serverValue })
	return { element, html: renderToStaticMarkup(element), button: SeasonSwitch(element.props).props.children[1] }
}

beforeEach(() => {
	vi.clearAllMocks()
	hooks.states.length = 0
	vi.mocked(setSeasonRegistration).mockReset().mockResolvedValue({ ok: true })
})

it.each([false, true])("toggles registration=%s through its own action without touching autosave", async (open) => {
	const view = render(open)
	expect(view.html).toContain(`aria-checked="${open}"`)
	expect(view.html).toContain(open ? ">Open</button>" : ">Closed</button>")
	expect(view.html).toContain("New teams can sign up at /register.")
	expect(view.button.props.type).toBe("button")
	expect(view.button.props.role).toBe("switch")
	expect(view.button.props.onKeyDown).toBeUndefined()
	view.button.props.onClick()
	await vi.waitFor(() => expect(render(open).element.props.checked).toBe(!open))
	expect(setSeasonRegistration).toHaveBeenCalledWith("s1", !open)
	expect(useAutosaveField).not.toHaveBeenCalled()
})

it("disables while saving, retains the stored value on rejection and shows its exact inline error", async () => {
	let resolve!: (value: { ok: false; error: string }) => void
	vi.mocked(setSeasonRegistration).mockReturnValueOnce(
		new Promise((done) => {
			resolve = done
		}),
	)
	render().button.props.onClick()
	expect(render().button.props.disabled).toBe(true)
	render().button.props.onClick()
	expect(setSeasonRegistration).toHaveBeenCalledOnce()
	resolve({ ok: false, error: 'Registration is already open for "Spring Hunt".' })
	await vi.waitFor(() => expect(render().html).toContain("Spring Hunt"))
	const failed = render()
	expect(failed.html).toContain('role="alert"')
	expect(failed.html).toContain("Registration is already open for &quot;Spring Hunt&quot;.")
	expect(failed.html).toContain("text-warn")
	expect(failed.html).not.toContain("New teams can sign up at /register.")
	expect(failed.element.props.checked).toBe(false)
	expect(failed.button.props.disabled).toBe(false)
	failed.button.props.onClick()
	await vi.waitFor(() => expect(render().element.props.checked).toBe(true))
	expect(render().html).not.toContain("Spring Hunt")
	expect(useAutosaveField).not.toHaveBeenCalled()
})

it("recovers after a network failure and accepts a changed server value from another tab", async () => {
	vi.mocked(setSeasonRegistration).mockRejectedValueOnce(new Error("offline"))
	render().button.props.onClick()
	await vi.waitFor(() => expect(render().html).toContain("Not saved, retry"))
	expect(render().button.props.disabled).toBe(false)
	render(true)
	hooks.effects[0]?.()
	expect(render(true).element.props.checked).toBe(true)
})
