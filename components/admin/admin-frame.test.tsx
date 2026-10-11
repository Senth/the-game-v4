import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { AdminFrame } from "./admin-frame"

it("renders responsive header and menu slots with logout at the far right", () => {
	const html = renderToStaticMarkup(
		<AdminFrame
			title="Seasons"
			status={<span>Status slot</span>}
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
	expect(html).toContain("Menu slot")
	expect(html).toContain("Phone slot")
	expect(html).toContain("Content slot")
	expect(html).toContain('class="ml-auto"')
	expect(html).toContain('action="/logout" method="post"')
	expect(html).toContain("min-w-0 flex-1")
})
