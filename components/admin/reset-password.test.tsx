import { redirect } from "next/navigation"
import type { JSX } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { type CreateTeamState, resetTeamPasswordAction } from "@/app/admin/team-actions"
import { ResetPassword } from "./reset-password"

const hooks = vi.hoisted(() => ({
	values: [] as (boolean | string)[],
	cursor: 0,
	result: {} as CreateTeamState,
	pending: false,
	effects: [] as (() => void)[],
}))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: boolean | string) => {
		const index = hooks.cursor++
		hooks.values[index] ??= initial
		return [
			hooks.values[index],
			(value: boolean | string) => {
				hooks.values[index] = value
			},
		]
	},
	useId: () => "reset-password",
	useRef: () => ({ current: null }),
	useEffect: (effect: () => void) => hooks.effects.push(effect),
	useActionState: (reducer: (state: CreateTeamState, data: FormData) => Promise<CreateTeamState>) => [
		hooks.result,
		async (data: FormData) => {
			hooks.result = await reducer(hooks.result, data)
		},
		hooks.pending,
	],
}))
vi.mock("@/app/admin/team-actions", () => ({ resetTeamPasswordAction: vi.fn() }))

function control() {
	hooks.cursor = 0
	return ResetPassword({ seasonId: "season", teamId: "ninjas" })
}

function form() {
	const child = control().props.children
	const Form = child.type as (props: unknown) => JSX.Element
	const element = Form(child.props)
	const children = element.props.children
	return {
		element,
		label: children[0],
		input: children[1],
		cancel: children[4].props.children[0],
		submit: children[4].props.children[1],
	}
}

function open() {
	control().props.children.props.children[0].props.onClick()
	hooks.values.length = 2
	hooks.result = {}
	return form()
}

beforeEach(() => {
	vi.clearAllMocks()
	hooks.values.length = 0
	hooks.result = {}
	hooks.pending = false
	hooks.effects.length = 0
	vi.mocked(resetTeamPasswordAction).mockResolvedValue({ ok: true })
})

it("rests as a quiet 44 px link without a form or success message", () => {
	const html = renderToStaticMarkup(control())
	expect(html).toContain("Reset password")
	expect(html).toContain("text-link")
	expect(html).toContain("min-h-11")
	expect(html).not.toMatch(/<form|<input|Password changed\./)
})

it("opens a labelled visible password field, helper and secondary controls", () => {
	const { element, input, label, cancel, submit } = open()
	expect(label.props.htmlFor).toBe(input.props.id)
	expect(input.props).toMatchObject({
		name: "password",
		type: "text",
		autoComplete: "off",
		minLength: 4,
		required: true,
	})
	expect(input.props["aria-describedby"]).toBe("reset-password-helper")
	expect(renderToStaticMarkup(element)).toContain("Phones already logged in stay in. Old QR links stop working.")
	expect(cancel.props.children).toBe("Cancel")
	expect(cancel.props.type).toBe("button")
	expect(submit.props.children).toBe("Set password")
	expect(submit.props.className).toContain("border-z2")
	expect(submit.props.className).not.toContain("bg-accent")
})

it("lets short passwords reach server validation and renders its inline error", async () => {
	open().input.props.onChange({ target: { value: "abc" } })
	const current = form()
	expect(current.element.props.noValidate).toBe(true)
	const data = new FormData()
	data.set("password", "abc")
	vi.mocked(resetTeamPasswordAction).mockResolvedValueOnce({
		ok: false,
		error: "Passwords need at least 4 characters.",
	})
	await current.element.props.action(data)
	expect(resetTeamPasswordAction).toHaveBeenCalledWith("season", "ninjas", {}, data)
	const failed = form()
	expect(failed.input.props.value).toBe("abc")
	expect(failed.input.props["aria-invalid"]).toBe(true)
	expect(failed.input.props["aria-describedby"]).toContain("reset-password-error")
	expect(renderToStaticMarkup(failed.element)).toContain(
		'role="alert" class="mt-2 font-cond text-sm text-warn">Passwords need at least 4 characters.',
	)
})

it("focuses newly opened input so immediate Escape closes without saving", () => {
	const current = open()
	const focus = vi.fn()
	current.input.props.ref.current = { focus }
	hooks.effects.at(-1)?.()
	expect(focus).toHaveBeenCalledOnce()
	const preventDefault = vi.fn()
	current.element.props.onKeyDown({ key: "Escape", preventDefault })
	expect(preventDefault).toHaveBeenCalledOnce()
	expect(renderToStaticMarkup(control())).not.toContain("<input")
	expect(resetTeamPasswordAction).not.toHaveBeenCalled()
	expect(open().input.props.value).toBe("")
})

it.each(["Cancel", "Escape"])(
	"%s closes without saving and clears password and previous errors on reopening",
	async (method) => {
		open().input.props.onChange({ target: { value: "secret" } })
		vi.mocked(resetTeamPasswordAction).mockResolvedValueOnce({
			ok: false,
			error: "Passwords need at least 4 characters.",
		})
		await form().element.props.action(new FormData())
		vi.mocked(resetTeamPasswordAction).mockClear()
		const current = form()
		if (method === "Cancel") current.cancel.props.onClick()
		else {
			const preventDefault = vi.fn()
			current.element.props.onKeyDown({ key: "Escape", preventDefault })
			expect(preventDefault).toHaveBeenCalledOnce()
		}
		expect(hooks.values[2]).toBe("")
		expect(renderToStaticMarkup(control())).not.toContain("<input")
		expect(resetTeamPasswordAction).not.toHaveBeenCalled()
		const reopened = open()
		expect(reopened.input.props.value).toBe("")
		expect(renderToStaticMarkup(reopened.element)).not.toContain('role="alert"')
	},
)

it("keeps password after server error, announces exact copy, then closes on success until reopened", async () => {
	open().input.props.onChange({ target: { value: "secret" } })
	const data = new FormData()
	data.set("password", "secret")
	vi.mocked(resetTeamPasswordAction).mockResolvedValueOnce({
		ok: false,
		error: "Passwords need at least 4 characters.",
	})
	await form().element.props.action(data)
	expect(resetTeamPasswordAction).toHaveBeenCalledWith("season", "ninjas", {}, data)
	const failed = form()
	expect(failed.input.props.value).toBe("secret")
	expect(failed.input.props["aria-invalid"]).toBe(true)
	expect(failed.input.props["aria-describedby"]).toBe("reset-password-helper reset-password-error")
	expect(renderToStaticMarkup(failed.element)).toContain(
		'role="alert" class="mt-2 font-cond text-sm text-warn">Passwords need at least 4 characters.',
	)
	await failed.element.props.action(data)
	const html = renderToStaticMarkup(control())
	expect(html).toContain("Reset password")
	expect(html).toContain('role="status" class="font-cond text-sm text-muted">Password changed.')
	expect(html).not.toContain("<input")
	expect(renderToStaticMarkup(control())).toContain("Password changed.")
	open()
	expect(hooks.values[1]).toBe(false)
})

it("disables field and controls during submission and ignores Escape", () => {
	open().input.props.onChange({ target: { value: "secret" } })
	hooks.pending = true
	const current = form()
	expect(current.input.props.disabled).toBe(true)
	expect(current.cancel.props.disabled).toBe(true)
	expect(current.submit.props.disabled).toBe(true)
	expect(current.submit.props.children).toBe("Setting…")
	current.element.props.onKeyDown({ key: "Escape", preventDefault: vi.fn() })
	expect(hooks.values[0]).toBe(true)
	expect(hooks.values[2]).toBe("secret")
})

it("retains password after transport failure and permits retry", async () => {
	open().input.props.onChange({ target: { value: "secret" } })
	vi.mocked(resetTeamPasswordAction).mockRejectedValueOnce(new TypeError("Failed to fetch"))
	await form().element.props.action(new FormData())
	expect(form().input.props.value).toBe("secret")
	expect(renderToStaticMarkup(form().element)).toContain("Not saved, retry")
	await form().element.props.action(new FormData())
	expect(renderToStaticMarkup(control())).toContain("Password changed.")
})

it("preserves Next.js redirects", async () => {
	open()
	vi.mocked(resetTeamPasswordAction).mockImplementationOnce(async () => redirect("/login"))
	await expect(form().element.props.action(new FormData())).rejects.toMatchObject({
		digest: "NEXT_REDIRECT;replace;/login;307;",
	})
})
