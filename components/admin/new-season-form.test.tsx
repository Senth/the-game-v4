import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { type CreateSeasonState, createSeasonAction } from "@/app/admin/actions"
import { NewSeasonForm } from "./new-season-form"

const hooks = vi.hoisted(() => ({
	states: [] as (boolean | string)[],
	cursor: 0,
	effects: [] as EffectCallback[],
	result: {} as CreateSeasonState,
	pending: false,
	focus: vi.fn(),
}))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: boolean | string) => {
		const index = hooks.cursor++
		hooks.states[index] ??= initial
		return [
			hooks.states[index],
			(value: boolean | string) => {
				hooks.states[index] = value
			},
		]
	},
	useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
	useRef: () => ({ current: { focus: hooks.focus } }),
	useId: () => "season-title",
	useActionState: (reducer: typeof createSeasonAction) => [
		hooks.result,
		async (data: FormData) => {
			hooks.result = await reducer(hooks.result, data)
		},
		hooks.pending,
	],
}))
vi.mock("@/app/admin/actions", () => ({ createSeasonAction: vi.fn() }))

function render(variant: "menu" | "header" = "menu") {
	hooks.cursor = 0
	hooks.effects.length = 0
	const element = NewSeasonForm({ variant, children: <h1>Seasons</h1> })
	const first = element.props.children[0]
	const form = element.props.children[1] || undefined
	return {
		html: renderToStaticMarkup(element),
		form,
		trigger: variant === "header" ? first.props.children[1] : first,
		input: form?.props.children[1].props.children[0],
		submit: form?.props.children[1].props.children[1],
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	hooks.states.length = 0
	hooks.result = {}
	hooks.pending = false
	vi.mocked(createSeasonAction).mockResolvedValue({ error: "Season titles are 1 to 60 characters." })
})

it.each(["menu", "header"] as const)(
	"opens and focuses the %s form, submits and keeps empty-title errors open",
	async (variant) => {
		const closed = render(variant)
		expect(closed.html).toContain(variant === "menu" ? "+ New season" : "New season")
		expect(closed.html).not.toContain("<input")
		closed.trigger.props.onClick()
		const open = render(variant)
		for (const effect of hooks.effects) effect()
		expect(hooks.focus).toHaveBeenCalledOnce()
		expect(open.input.props.name).toBe("title")
		expect(open.input.props.required).toBeUndefined()
		const data = new FormData()
		data.set("title", "")
		await open.form.props.action(data)
		expect(createSeasonAction).toHaveBeenCalledWith({}, data)
		const error = render(variant)
		expect(error.html).toContain('role="alert"')
		expect(error.html).toContain("Season titles are 1 to 60 characters.")
		expect(error.html).toContain("<input")
		expect(error.input.props["aria-invalid"]).toBe(true)
		expect(error.input.props["aria-describedby"]).toBe("season-title-error")
		error.form.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null })
		expect(render(variant).html).toContain("<input")
	},
)

it("retains the entered title when an action returns an error", async () => {
	render().trigger.props.onClick()
	render().input.props.onChange({ target: { value: "x".repeat(61) } })
	const data = new FormData()
	data.set("title", "x".repeat(61))
	await render().form.props.action(data)
	expect(render().input.props.value).toBe("x".repeat(61))
})

it("closes on Escape or leaving an empty field, not when focusing Create or leaving a filled field", () => {
	render().trigger.props.onClick()
	render().form.props.onBlur({ currentTarget: { contains: () => true }, relatedTarget: {} })
	expect(render().html).toContain("<input")
	render().form.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null })
	expect(render().html).not.toContain("<input")
	render().trigger.props.onClick()
	render().input.props.onChange({ target: { value: "New hunt" } })
	render().form.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null })
	expect(render().html).toContain("<input")
	render().form.props.onKeyDown({ key: "Escape" })
	expect(render().html).not.toContain("<input")
})

it("disables controls and keeps the form open during creation", () => {
	render().trigger.props.onClick()
	hooks.pending = true
	const pending = render()
	expect(pending.input.props.disabled).toBe(true)
	expect(pending.submit.props.disabled).toBe(true)
	expect(pending.html).toContain("Creating…")
	pending.form.props.onKeyDown({ key: "Escape" })
	pending.form.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null })
	expect(render().html).toContain("<input")
})
