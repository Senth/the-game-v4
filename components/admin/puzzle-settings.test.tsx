import { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import type { Quest } from "@/lib/domain/schemas"
import { useAutosaveField } from "./autosave-provider"
import { PuzzleSettings } from "./puzzle-settings"

vi.mock("./autosave-provider", () => ({ useAutosaveField: vi.fn() }))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useId: () => "puzzle",
}))

const field = {
	value: null as Quest["puzzle"],
	onChange: vi.fn(),
	onFocus: vi.fn(),
	onBlur: vi.fn(),
	failed: false,
	error: undefined as string | undefined,
}
const props = {
	arcId: "arc",
	questId: "quest",
	assetPath: "/assets/chart.png",
	puzzle: null,
	reachedTeams: 0,
}
type ButtonProps = {
	children?: ReactNode
	"aria-label"?: string
	onClick?: () => void
	disabled?: boolean
}

function button(node: ReactNode, label: string): ReactElement<ButtonProps> | undefined {
	return Array.isArray(node)
		? node.map((child) => button(child, label)).find(Boolean)
		: isValidElement<ButtonProps>(node)
			? node.type === "button" && node.props["aria-label"] === label
				? (node as ReactElement<ButtonProps>)
				: typeof node.type === "function"
					? button((node.type as (props: ButtonProps) => ReactNode)(node.props as ButtonProps), label)
					: button(node.props.children, label)
			: undefined
}

beforeEach(() => {
	vi.clearAllMocks()
	field.value = null
	field.failed = false
	field.error = undefined
	vi.mocked(useAutosaveField).mockReturnValue(field as ReturnType<typeof useAutosaveField>)
})

it("shows only the image helper when quest has no image", () => {
	const html = renderToStaticMarkup(<PuzzleSettings {...props} assetPath="/assets/clue.pdf" />)
	expect(html).toContain(">Puzzle</span>")
	expect(html).toContain("Upload an image to enable puzzle mode.")
	expect(html).not.toContain('role="switch"')
	expect(html).not.toContain("Rows")
})

it("toggles puzzle mode and starts with default 4 by 4 dimensions", () => {
	const element = PuzzleSettings(props)
	button(element, "Puzzle mode")?.props.onClick?.()
	expect(useAutosaveField).toHaveBeenCalledWith({ arcId: "arc", questId: "quest", field: "puzzle" }, null)
	expect(field.onChange).toHaveBeenCalledWith({ rows: 4, cols: 4, showFull: false })
	field.value = { rows: 4, cols: 4, showFull: false }
	const html = renderToStaticMarkup(<PuzzleSettings {...props} puzzle={{ rows: 4, cols: 4, showFull: false }} />)
	expect(html).toContain("Players get shuffled pieces, never the picture.")
	expect(html).toContain('min="2" max="7" step="1"')
	expect(html).toContain("Players see the picture above the pieces.")
})

it("shows dimension range errors", () => {
	field.value = { rows: 8, cols: 4, showFull: false }
	const html = renderToStaticMarkup(<PuzzleSettings {...props} puzzle={field.value} />)
	expect(html).toContain("Use 2 to 7.")
	expect(html).toContain('aria-invalid="true"')
	expect(html).toContain('value="8"')
	expect(html).toContain("w-40")
	field.value = { rows: Number.NaN, cols: 4, showFull: false }
	expect(renderToStaticMarkup(<PuzzleSettings {...props} puzzle={field.value} />)).toContain('value=""')
})

it("locks puzzle mode and dimensions after teams reach it but leaves full-picture switch editable", () => {
	field.value = { rows: 4, cols: 4, showFull: false }
	const html = renderToStaticMarkup(
		<PuzzleSettings {...props} puzzle={{ rows: 4, cols: 4, showFull: false }} reachedTeams={2} />,
	)
	expect(html).toContain("Locked: 2 teams have reached this puzzle.")
	expect(html).toContain('disabled=""')
	const lockedMode = button(
		PuzzleSettings({ ...props, puzzle: { rows: 4, cols: 4, showFull: false }, reachedTeams: 2 }),
		"Puzzle mode",
	)
	const fullPicture = button(
		PuzzleSettings({ ...props, puzzle: { rows: 4, cols: 4, showFull: false }, reachedTeams: 2 }),
		"Show full picture",
	)
	expect(lockedMode?.props.disabled).toBe(true)
	expect(fullPicture?.props.disabled).not.toBe(true)
})
