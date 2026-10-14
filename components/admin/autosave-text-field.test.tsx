import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { useAutosaveField } from "./autosave-provider"
import { AutosaveTextField } from "./autosave-text-field"

vi.mock("./autosave-provider", () => ({ useAutosaveField: vi.fn() }))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useId: () => "title",
}))

const target = { field: "title" } as const
const field = {
	value: "Cipher Night 2026",
	onChange: vi.fn(),
	onFocus: vi.fn(),
	onBlur: vi.fn(async () => {}),
	failed: false,
	error: undefined,
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(useAutosaveField).mockReturnValue(field)
})

it("renders the server title with its label and no failure flag or Save button", () => {
	const html = renderToStaticMarkup(<AutosaveTextField label="Title" target={target} serverValue="Cipher Night 2026" />)
	expect(useAutosaveField).toHaveBeenCalledWith(target, "Cipher Night 2026")
	const id = html.match(/<input id="([^"]+)"/)?.[1]
	expect(id).toBeDefined()
	expect(html).toContain(`for="${id}"`)
	expect(html).toContain(">Title</label>")
	expect(html).toContain('value="Cipher Night 2026"')
	expect(html).toContain("border-z2")
	expect(html).not.toContain("border-warn")
	expect(html).not.toContain("Not saved")
	expect(html).not.toContain("<button")
})

it("marks failed edits with a warn border and an accessible Not saved line", () => {
	vi.mocked(useAutosaveField).mockReturnValue({ ...field, value: "Local title", failed: true })
	const html = renderToStaticMarkup(<AutosaveTextField label="Title" target={target} serverValue="Old title" />)
	const id = html.match(/<input id="([^"]+)"/)?.[1]
	expect(html).toContain('value="Local title"')
	expect(html).toContain("border-warn")
	expect(html).not.toContain("border-z2")
	expect(html).toContain('aria-invalid="true"')
	expect(html).toContain(`aria-describedby="${id}-error"`)
	expect(html).toContain(`id="${id}-error" role="alert" class="mt-1.5 font-cond text-xs text-warn">Not saved`)
})

it("shows the action's exact error instead of generic Not saved copy", () => {
	vi.mocked(useAutosaveField).mockReturnValue({ ...field, failed: true, error: "Invalid value." })
	const html = renderToStaticMarkup(<AutosaveTextField label="Title" target={target} serverValue="Old title" />)
	expect(html).toContain("Invalid value.")
	expect(html).not.toContain("Not saved")
})

it("passes title edits, focus and blur to the autosave hook", async () => {
	const element = AutosaveTextField({ label: "Title", target, serverValue: "Cipher Night 2026" })
	const input = element
	input.props.onChange({ target: { value: "New title" } })
	input.props.onFocus()
	await input.props.onBlur()
	expect(field.onChange).toHaveBeenCalledWith("New title")
	expect(field.onFocus).toHaveBeenCalledOnce()
	expect(field.onBlur).toHaveBeenCalledOnce()
})

it("keeps inline label notes and forwards autofocus for newly added quest titles", () => {
	const label = (
		<>
			Display title <span className="ml-2 font-body normal-case tracking-normal">players see this</span>
		</>
	)
	const element = AutosaveTextField({ label, target, serverValue: "", autoFocus: true })
	expect(element.props.label).toBe(label)
	expect(element.props.autoFocus).toBe(true)
	const html = renderToStaticMarkup(element)
	expect(html).toContain("players see this</span></label>")
	expect(html).toContain('autofocus=""')
})
