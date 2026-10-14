import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { useAutosaveField } from "./autosave-provider"
import { AutosaveTextarea } from "./autosave-textarea"

const hooks = vi.hoisted(() => ({
	effects: [] as EffectCallback[],
	ref: { current: null as { style: { height: string }; scrollHeight: number } | null },
}))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useId: () => "textarea",
	useRef: () => hooks.ref,
	useLayoutEffect: (effect: EffectCallback) => hooks.effects.push(effect),
}))
vi.mock("./autosave-provider", () => ({ useAutosaveField: vi.fn() }))

const target = { arcId: "arc", questId: "quest", field: "content" } as const
const field = {
	value: "First line",
	onChange: vi.fn(),
	onFocus: vi.fn(),
	onBlur: vi.fn(async () => {}),
	failed: false,
	error: undefined,
}
const props = { label: "Content", target, serverValue: "First line", minRows: 5, mono: true }

beforeEach(() => {
	vi.clearAllMocks()
	hooks.effects = []
	hooks.ref.current = { style: { height: "" }, scrollHeight: 120 }
	vi.mocked(useAutosaveField).mockReturnValue(field)
})

it("renders labelled, five-line monospace content without internal scrolling or resize handle", () => {
	const html = renderToStaticMarkup(<AutosaveTextarea {...props} />)
	expect(useAutosaveField).toHaveBeenCalledWith(target, "First line")
	expect(html).toContain('for="textarea"')
	expect(html).toContain('id="textarea" rows="5"')
	expect(html).toContain("font-mono")
	expect(html).toContain("resize-none overflow-hidden")
	expect(html).not.toContain("h-11 w-full")
	expect(html).not.toContain("<button")
	expect(html).not.toContain("Not saved")
	expect(renderToStaticMarkup(<AutosaveTextarea {...props} label="Admin notes" minRows={1} mono={false} />)).toContain(
		"font-body",
	)
})

it("resets height before measuring and grows or shrinks with each value change", () => {
	const textarea = hooks.ref.current
	if (!textarea) throw new Error("Missing textarea fixture")
	const heights: string[] = []
	let measuredHeight = 0
	Object.defineProperty(textarea, "scrollHeight", {
		get() {
			heights.push(textarea.style.height)
			return measuredHeight
		},
	})
	for (const value of ["First line", "Longer multiline\ncontent", "Short"]) {
		measuredHeight = value.length * 10
		vi.mocked(useAutosaveField).mockReturnValue({ ...field, value })
		AutosaveTextarea(props)
		const effect = hooks.effects.pop()
		expect(effect).toBeDefined()
		effect?.()
		expect(textarea.style.height).toBe(`${measuredHeight}px`)
	}
	expect(heights).toEqual(["auto", "auto", "auto"])
	hooks.ref.current = null
	AutosaveTextarea(props)
	expect(() => hooks.effects.pop()?.()).not.toThrow()
})

it("forwards edits, focus and blur to autosave", async () => {
	const textarea = AutosaveTextarea(props).props.children[1]
	textarea.props.onChange({ target: { value: "New content\nSecond line" } })
	textarea.props.onFocus()
	await textarea.props.onBlur()
	expect(field.onChange).toHaveBeenCalledWith("New content\nSecond line")
	expect(field.onFocus).toHaveBeenCalledOnce()
	expect(field.onBlur).toHaveBeenCalledOnce()
})

it.each([undefined, "Invalid value."])("matches failed input styling and shows %s", (error) => {
	vi.mocked(useAutosaveField).mockReturnValue({ ...field, failed: true, error })
	const html = renderToStaticMarkup(<AutosaveTextarea {...props} />)
	expect(html).toContain("border-warn")
	expect(html).toContain("focus:border-warn")
	expect(html).not.toContain("border-z2")
	expect(html).toContain('aria-invalid="true" aria-describedby="textarea-error"')
	expect(html).toContain('id="textarea-error" role="alert"')
	expect(html).toContain(error ?? "Not saved")
})
