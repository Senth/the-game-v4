import { Children, isValidElement, type ReactElement, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ConfirmDialog } from "./confirm-dialog"

const hooks = vi.hoisted(() => ({
	showModal: vi.fn(),
	close: vi.fn(),
	focus: vi.fn(),
	refIndex: 0,
	idIndex: 0,
}))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useEffect: (effect: () => void) => effect(),
	useRef: () => ({
		current: hooks.refIndex++ === 0 ? { showModal: hooks.showModal, close: hooks.close } : { focus: hooks.focus },
	}),
	useId: () => `confirm-id-${hooks.idIndex++}`,
}))
vi.mock("react-dom", () => ({ createPortal: vi.fn((node: ReactNode) => node) }))

type ButtonProps = { children?: ReactNode; className?: string; onClick: () => void }
type DialogProps = {
	"aria-labelledby"?: string
	"aria-describedby"?: string
	onCancel?: () => void
	onClose?: () => void
}

function buttons(node: ReactNode): ReactElement<ButtonProps>[] {
	return Children.toArray(node).flatMap((child) => {
		if (!isValidElement<ButtonProps>(child)) return []
		return child.type === "button" ? [child] : buttons(child.props.children)
	})
}

function render(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
	const onConfirm = vi.fn()
	const onClose = vi.fn()
	hooks.refIndex = 0
	hooks.idIndex = 0
	const dialog = ConfirmDialog({
		open: true,
		title: "Remove this quest?",
		body: "Its answers and hints go too.",
		confirmLabel: "Remove quest",
		onConfirm,
		onClose,
		...props,
	})
	if (!isValidElement<DialogProps>(dialog)) throw new Error("Missing confirmation dialog")
	return { dialog, buttons: buttons(dialog), onConfirm, onClose }
}

beforeEach(() => {
	vi.clearAllMocks()
	hooks.refIndex = 0
	hooks.idIndex = 0
	vi.stubGlobal("document", { body: {} })
})
afterEach(() => vi.unstubAllGlobals())

it("opens natively and focuses Cancel", () => {
	const view = render()
	expect(hooks.showModal).toHaveBeenCalledOnce()
	expect(hooks.focus).toHaveBeenCalledOnce()
	expect(createPortal).toHaveBeenCalledOnce()
	expect(vi.mocked(createPortal).mock.calls[0]?.[1]).toBe(document.body)
	expect(view.dialog.props["aria-labelledby"]).toBe("confirm-id-0")
	expect(view.dialog.props["aria-describedby"]).toBe("confirm-id-1")
})

it("closes without confirming when Cancel is clicked", () => {
	const view = render()
	view.buttons[0]?.props.onClick()
	expect(hooks.close).toHaveBeenCalledOnce()
	expect(view.onConfirm).not.toHaveBeenCalled()
	view.dialog.props.onClose?.()
	expect(view.onClose).toHaveBeenCalledOnce()
})

it("closes when Escape triggers the native close event", () => {
	const view = render()
	expect(view.dialog.props.onCancel).toBeUndefined()
	view.dialog.props.onClose?.()
	expect(view.onClose).toHaveBeenCalledOnce()
	expect(view.onConfirm).not.toHaveBeenCalled()
})

it("closes and confirms only when confirm is clicked", () => {
	const view = render()
	view.buttons[1]?.props.onClick()
	expect(hooks.close).toHaveBeenCalledOnce()
	expect(view.onConfirm).toHaveBeenCalledOnce()
	expect(view.onClose).not.toHaveBeenCalled()
})

it("keeps async confirmation open and announces failure inside dialog", () => {
	const view = render({ closeOnConfirm: false, error: "Not saved, retry" })
	view.buttons[1]?.props.onClick()
	expect(hooks.close).not.toHaveBeenCalled()
	expect(view.onConfirm).toHaveBeenCalledOnce()
	const html = renderToStaticMarkup(view.dialog)
	expect(html).toContain('role="alert"')
	expect(html).toContain("Not saved, retry")
	expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf("</dialog>"))
})

it("renders node bodies and accent confirmation buttons", () => {
	const view = render({
		body: (
			<div>
				<strong>2 teams affected</strong>
			</div>
		),
		confirmTone: "accent",
	})
	const html = renderToStaticMarkup(view.dialog)
	expect(html).toContain("2 teams affected")
	expect(view.buttons[1]?.props.className).toContain("bg-accent")
})

it("renders result action beside Close", () => {
	const view = render({
		title: "Copied to Spring Hunt 2027",
		body: "Lighthouse is now the last arc there, with 1 new quest.",
		cancelLabel: "Close",
		result: { label: "Open it ›", href: "/admin/seasons/spring" },
	})
	const html = renderToStaticMarkup(view.dialog)
	expect(html).toContain("Lighthouse is now the last arc there, with 1 new quest.")
	expect(html).toContain(">Close</button>")
	expect(html).toContain('href="/admin/seasons/spring"')
	expect(html).toContain("Open it ›")
	expect(html).not.toContain("Remove quest")
})
