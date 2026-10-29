import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { AdminFrame } from "./admin-frame"

it("renders responsive header and menu slots with logout at the far right", () => {
	const html = renderToStaticMarkup(
		<AdminFrame
			title="Seasons"
			status={<span>Status slot</span>}
			controls={<button type="button">Controls slot</button>}
			menu={<nav>Menu slot</nav>}
			phoneHeader={<header>Phone slot</header>}
		>
			<p>Content slot</p>
		</AdminFrame>,
	)
	expect(html).toContain("hidden h-14")
	expect(html).toContain("lg:flex")
	expect(html).toContain('class="lg:hidden"')
	expect(html).toContain("w-72")
	expect(html).toContain("lg:block")
	expect(html).toContain("Status slot")
	expect(html).toContain("Controls slot")
	expect(html.indexOf("Controls slot")).toBeLessThan(html.indexOf('action="/logout"'))
	expect(html).toContain("Menu slot")
	expect(html).toContain("Phone slot")
	expect(html).toContain("Content slot")
	expect(html).toContain('class="ml-auto flex shrink-0 items-center gap-4"')
	expect(html).toContain("border-z1")
	expect(html).not.toContain("border-warn")
	expect(html).not.toContain("Saved")
	expect(html).toContain('action="/logout" method="post"')
	expect(html).toContain("min-w-0 flex-1")
	expect(html).not.toContain("w-92")
})

it("puts desktop live controls after autosave status and before logout", () => {
	const html = renderToStaticMarkup(
		<AdminFrame title="Season" menu={null} phoneHeader={null} controls={<span>Live controls</span>}>
			<p>Content</p>
		</AdminFrame>,
	)
	expect(html.indexOf("Live controls")).toBeGreaterThan(html.indexOf("ml-auto"))
	expect(html.indexOf("Live controls")).toBeLessThan(html.indexOf("Log out"))
})

it("keeps the preview beside the flexible middle pane only on desktop", () => {
	const html = renderToStaticMarkup(
		<AdminFrame
			title="Season"
			menu={<nav>Menu</nav>}
			phoneHeader={<header>Phone</header>}
			preview={<p>Preview slot</p>}
		>
			<p>Middle pane</p>
		</AdminFrame>,
	)
	expect(html).toContain("hidden w-92 shrink-0")
	expect(html).toContain("border-l border-z1 px-5 pt-6 lg:block")
	expect(html.indexOf("Preview slot")).toBeGreaterThan(html.indexOf("Middle pane"))
})

it("constrains the frame only when a live map fills the pane", () => {
	const html = renderToStaticMarkup(
		<AdminFrame title="Season" menu={null} phoneHeader={null}>
			<div className="live-map-canvas">Map</div>
		</AdminFrame>,
	)
	expect(html).toContain("has-[.live-map-canvas]:h-dvh")
	expect(html).toContain("has-[.live-map-canvas]:min-h-0")
	expect(html).toContain("has-[.live-map-canvas]:overflow-hidden")
})
