import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { LocationDock } from "./location-dock"

const live = { answer: "", onAnswerChange: vi.fn(), onSubmit: vi.fn(), pending: false, feedback: null }

describe("LocationDock", () => {
	it.each([
		["off", "Location off", "Arriving at the place solves this quest.", "Share location"],
		["on", "Location on", "Walk to the place. Arriving solves the quest.", null],
		["rough", "GPS too rough", "Step out into the open and wait a few seconds. The game keeps trying.", null],
		["blocked", "Location blocked", "Permissions › Location › Allow.", "Reload"],
		["unavailable", "Location unavailable", "This browser can&#x27;t share location.", null],
	] as const)("renders %s status and help", (state, label, helper, button) => {
		const html = renderToStaticMarkup(<LocationDock {...live} state={state} hasAnswers={false} onShare={vi.fn()} />)
		expect(html).toContain(label)
		expect(html).toContain(helper)
		expect(html).toContain('role="status"')
		expect(html).toContain("fixed inset-x-0 bottom-0")
		expect(html).not.toContain("<input")
		if (button) expect(html).toContain(`>${button}</button>`)
		else expect(html).not.toContain("<button")
	})

	it.each(["on", "rough"] as const)("renders rounded accuracy and reduced-motion-safe pulse for %s", (state) => {
		const html = renderToStaticMarkup(<LocationDock {...live} state={state} accuracy={51.7} hasAnswers={false} />)
		expect(html).toContain("±52 m")
		expect(html).toContain("motion-safe:animate-pulse")
		expect(html).toContain(state === "rough" ? "text-warn" : "text-muted")
	})

	it("keeps backup input and Send under status in one fixed dock", () => {
		const html = renderToStaticMarkup(<LocationDock {...live} state="on" hasAnswers />)
		expect(html).toContain('placeholder="Code from the sign"')
		expect(html).toContain(">Send</button>")
		expect(html.indexOf("Location on")).toBeLessThan(html.indexOf("<input"))
		expect(html.match(/fixed inset-x-0 bottom-0/g)).toHaveLength(1)
	})

	it("shows found earnings and keeps backup controls inert", () => {
		const html = renderToStaticMarkup(<LocationDock {...live} state="on" hasAnswers pointsEarned={15} />)
		expect(html).toContain("Found it · +15p")
		expect(html).toContain("Next quest in a moment.")
		expect(html).toMatch(/<input[^>]*disabled=""/)
		expect(html).toMatch(/<button[^>]*disabled=""/)
	})

	it.each([true, false])("renders inert Off preview with answers=%s", (hasAnswers) => {
		const html = renderToStaticMarkup(<LocationDock preview hasAnswers={hasAnswers} />)
		expect(html).toContain("Location off")
		expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Share location<\/button>/)
		if (hasAnswers) expect(html).toMatch(/<input[^>]*disabled=""/)
	})
})
