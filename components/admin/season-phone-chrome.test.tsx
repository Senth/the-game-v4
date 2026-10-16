import { useSelectedLayoutSegments } from "next/navigation"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it, vi } from "vitest"
import { SeasonPhoneChrome } from "./season-phone-chrome"

vi.mock("next/navigation", () => ({ useSelectedLayoutSegments: vi.fn() }))

it.each([
	{ segments: [], hidden: false },
	{ segments: ["teams"], hidden: false },
	{ segments: ["settings"], hidden: false },
	{ segments: ["quests", "quest"], hidden: true },
	{ segments: ["teams", "ninjas"], hidden: true },
])("sets season phone chrome hidden=$hidden for $segments", ({ segments, hidden }) => {
	vi.mocked(useSelectedLayoutSegments).mockReturnValue(segments)
	const html = renderToStaticMarkup(
		<SeasonPhoneChrome>
			<header>Season header</header>
			<p>Live strip</p>
			<nav>Tabs</nav>
		</SeasonPhoneChrome>,
	)
	if (hidden) expect(html).toBe("")
	else expect(html).toBe("<header>Season header</header><p>Live strip</p><nav>Tabs</nav>")
})
