import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { QuestViewToggle } from "./quest-view-toggle"

const hooks = vi.hoisted(() => ({ view: "edit" as "edit" | "preview" }))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: "edit" | "preview") => [
		hooks.view ?? initial,
		(value: "edit" | "preview") => (hooks.view = value),
	],
}))

function render() {
	return QuestViewToggle({ children: <div>Editor field</div>, preview: <main>Quest content</main> })
}

beforeEach(() => {
	hooks.view = "edit"
})

it("starts in Edit with M2's quiet, sticky segmented control", () => {
	const toggle = render()
	const html = renderToStaticMarkup(toggle)
	expect(html).toContain('class="sticky top-12 z-10 bg-z0 px-4 py-2 border-b border-z1 lg:hidden"')
	expect(html).toContain('class="grid grid-cols-2 rounded-md bg-z1 p-1 font-cond text-sm"')
	expect(html).toContain('aria-pressed="true" class="h-11 rounded bg-z2 text-head')
	expect(html).toContain('aria-pressed="false" class="h-11 text-muted')
	expect(html).toContain("Editor field")
	expect(html).toContain('class="hidden"><main>Quest content</main></div>')
})

it("shows player preview while keeping editor mounted and resets through Edit", () => {
	const toggle = render()
	const buttons = toggle.props.children[0].props.children.props.children
	buttons[1].props.onClick()
	const preview = render()
	const html = renderToStaticMarkup(preview)
	expect(html).toContain('aria-pressed="false" class="h-11 text-muted')
	expect(html).toContain('aria-pressed="true" class="h-11 rounded bg-z2 text-head')
	expect(html).toContain('class="hidden lg:block"><div>Editor field</div></div>')
	expect(html).toContain('class="lg:hidden"><main>Quest content</main></div>')
	preview.props.children[0].props.children.props.children[0].props.onClick()
	expect(renderToStaticMarkup(render())).toContain('class="hidden"><main>Quest content</main></div>')
})
