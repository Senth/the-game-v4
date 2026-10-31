import { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import type { Quest } from "@/lib/domain/schemas"
import { useAutosaveField } from "./autosave-provider"
import { DropSettings } from "./drop-settings"

vi.mock("./autosave-provider", () => ({
	useAutosaveField: vi.fn(),
	useDraftValue: vi.fn((_target: unknown, value: unknown) => value),
}))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useId: () => "drop",
}))

const drop = { fullMinutes: 10, dropMinutes: 20, floor: 0 }
const field = {
	value: null as Quest["drop"],
	onChange: vi.fn(),
	onFocus: vi.fn(),
	onBlur: vi.fn(),
	failed: false,
	error: undefined as string | undefined,
}
const props = { arcId: "arc", questId: "quest", drop: null, points: 20 }
type SwitchProps = {
	"aria-label"?: string
	onClick?: () => void
	onFocus?: () => void
	onBlur?: () => void
	children?: ReactNode
}

function findSwitch(node: ReactNode, label: string): ReactElement<SwitchProps> | undefined {
	return Array.isArray(node)
		? node.map((child) => findSwitch(child, label)).find(Boolean)
		: isValidElement<SwitchProps>(node)
			? node.type === "button" && node.props["aria-label"] === label
				? (node as ReactElement<SwitchProps>)
				: typeof node.type === "function"
					? findSwitch((node.type as (props: SwitchProps) => ReactNode)(node.props as SwitchProps), label)
					: findSwitch(node.props.children, label)
			: undefined
}

beforeEach(() => {
	vi.clearAllMocks()
	field.value = null
	field.failed = false
	field.error = undefined
	vi.mocked(useAutosaveField).mockReturnValue(field as ReturnType<typeof useAutosaveField>)
})

it("enables with defaults and disables by saving null", () => {
	const disabled = DropSettings(props)
	expect(useAutosaveField).toHaveBeenCalledWith({ arcId: "arc", questId: "quest", field: "drop" }, null)
	expect(renderToStaticMarkup(disabled)).toContain('aria-checked="false"')
	findSwitch(disabled, "Drop over time")?.props.onClick?.()
	expect(field.onChange).toHaveBeenLastCalledWith(drop)

	field.value = drop
	const enabled = DropSettings({ ...props, drop })
	expect(renderToStaticMarkup(enabled)).toContain('aria-checked="true"')
	findSwitch(enabled, "Drop over time")?.props.onClick?.()
	expect(field.onChange).toHaveBeenLastCalledWith(null)
})

it.each([
	["fullMinutes", -1, "Use 0 to 1440."],
	["fullMinutes", 1441, "Use 0 to 1440."],
	["dropMinutes", 0, "Use 1 to 1440."],
	["dropMinutes", 1441, "Use 1 to 1440."],
	["floor", -1, "Use 0 to 10000."],
	["floor", 10001, "Use 0 to 10000."],
] as const)("shows range error for %s=%s", (key, invalid, message) => {
	field.value = { ...drop, [key]: invalid }
	const html = renderToStaticMarkup(<DropSettings {...props} drop={field.value} />)
	expect(html).toContain(message)
	expect(html).toContain('aria-invalid="true"')
})

it.each([
	["fullMinutes", 2000, "Full for", "Use 0 to 1440."],
	["dropMinutes", 0, "Drop over", "Use 1 to 1440."],
	["floor", 10001, "Floor", "Use 0 to 10000."],
] as const)("marks only invalid %s field", (key, invalid, label, message) => {
	field.value = { ...drop, [key]: invalid }
	const html = renderToStaticMarkup(<DropSettings {...props} drop={field.value} />)
	const inputFor = (fieldLabel: string) =>
		html.match(new RegExp(`<label[^>]*>${fieldLabel}</label>[\\s\\S]*?<input([^>]*)>`))?.[1] ?? ""

	expect(inputFor(label)).toContain('aria-invalid="true"')
	expect(html.match(/aria-invalid="true"/g)).toHaveLength(1)
	expect(html).toContain(message)
})

it("shows summary, floor warning and unset-points summary", () => {
	field.value = { ...drop, floor: 20 }
	let html = renderToStaticMarkup(<DropSettings {...props} drop={field.value} />)
	expect(html).toContain("20p for the first 10 min, then down to 20p at 30 min.")
	expect(html).toContain("Floor is at or above points, so nothing drops.")

	html = renderToStaticMarkup(<DropSettings {...props} points={null} drop={drop} />)
	expect(html).toContain("Set points first.")

	field.value = { ...drop, fullMinutes: Number.NaN }
	html = renderToStaticMarkup(<DropSettings {...props} drop={field.value} />)
	expect(html).not.toContain("NaN")
	expect(html).toContain("Use 0 to 1440.")
})

it("shows failed-save feedback and delegates blur retry", () => {
	field.value = drop
	field.failed = true
	field.error = "Not saved, retry"
	const html = renderToStaticMarkup(<DropSettings {...props} drop={drop} />)
	expect(html).toContain('role="alert"')
	expect(html).toContain("Not saved, retry")
	findSwitch(DropSettings({ ...props, drop }), "Drop over time")?.props.onBlur?.()
	expect(field.onBlur).toHaveBeenCalledOnce()
})
