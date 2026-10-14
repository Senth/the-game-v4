import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { AutosavePointsField } from "./autosave-points-field"
import { useAutosaveField } from "./autosave-provider"

vi.mock("./autosave-provider", () => ({ useAutosaveField: vi.fn() }))

const props = { arcId: "arc", questId: "quest", serverValue: 25 }
const field = {
	value: 25 as number | null,
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

it("uses the quest points target, numeric keyboard and whole-number bounds", () => {
	const html = renderToStaticMarkup(<AutosavePointsField {...props} />)
	expect(useAutosaveField).toHaveBeenCalledWith({ arcId: "arc", questId: "quest", field: "points" }, 25)
	expect(html).toContain(">Points</label>")
	expect(html).toContain('type="number" inputMode="numeric" step="1" min="0" max="10000"')
	expect(html).toContain('value="25"')
	expect(html).not.toContain("<button")
})

it("saves empty as null and non-empty as valueAsNumber, preserving zero", async () => {
	const input = AutosavePointsField(props)
	for (const value of [42, 0, 1.5, 10001]) {
		input.props.onChange({ target: { value: String(value), valueAsNumber: value } })
		expect(field.onChange).toHaveBeenLastCalledWith(value)
	}
	input.props.onChange({ target: { value: "", valueAsNumber: Number.NaN } })
	expect(field.onChange).toHaveBeenLastCalledWith(null)
	input.props.onFocus()
	await input.props.onBlur()
	expect(field.onFocus).toHaveBeenCalledOnce()
	expect(field.onBlur).toHaveBeenCalledOnce()
	vi.mocked(useAutosaveField).mockReturnValue({ ...field, value: null })
	expect(renderToStaticMarkup(<AutosavePointsField {...props} serverValue={null} />)).toContain('value=""')
})

it("keeps failed input and shows the server validation message with a warn border", () => {
	const error = "Use a whole number from 0 to 10000."
	vi.mocked(useAutosaveField).mockReturnValue({ ...field, value: 10001, failed: true, error })
	const html = renderToStaticMarkup(<AutosavePointsField {...props} />)
	expect(html).toContain('value="10001"')
	expect(html).toContain("border-warn")
	expect(html).toContain('aria-invalid="true"')
	expect(html).toContain('role="alert"')
	expect(html).toContain(error)
	expect(html).not.toContain("Not saved")
})
