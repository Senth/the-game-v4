import { useSelectedLayoutSegment } from "next/navigation"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it, vi } from "vitest"
import { SeasonPhoneChrome } from "./season-phone-chrome"

vi.mock("next/navigation", () => ({ useSelectedLayoutSegment: vi.fn() }))

it.each([null, "teams", "settings", "quests"])("shows season phone chrome except on %s quest segment", (segment) => {
	vi.mocked(useSelectedLayoutSegment).mockReturnValue(segment)
	const html = renderToStaticMarkup(
		<SeasonPhoneChrome>
			<header>Season header</header>
			<p>Live strip</p>
			<nav>Tabs</nav>
		</SeasonPhoneChrome>,
	)
	if (segment === "quests") expect(html).toBe("")
	else expect(html).toBe("<header>Season header</header><p>Live strip</p><nav>Tabs</nav>")
})
