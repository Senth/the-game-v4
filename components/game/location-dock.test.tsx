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

	it.each([
		[
			"far",
			"Warmer",
			"text-warn font-bold",
			"Hold the phone flat and follow the arrow. Arriving solves the quest. Keep this screen open and unlocked.",
		],
		[
			"close",
			"Colder",
			"text-muted font-bold",
			"Hold the phone flat and follow the arrow. Arriving solves the quest. Keep this screen open and unlocked.",
		],
	] as const)("shows the %s arrow guidance", (band, trend, statusClass, helper) => {
		const html = renderToStaticMarkup(
			<LocationDock
				{...live}
				state="on"
				guidanceEnabled
				guidance={{ band, bearing: 10, trend: trend === "Warmer" ? "warmer" : "colder" }}
				compass={{ state: "on", heading: 350, request: vi.fn() }}
				hasAnswers={false}
			/>,
		)
		expect(html).toContain(`>${trend}</span>`)
		expect(html).toContain(`class="text-sm ${statusClass}"`)
		expect(html).toContain(helper)
		expect(html).toContain('aria-hidden="true"')
		expect(html).toContain('class="size-8')
		expect(html).toContain('style="transform:rotate(20deg)"')
		expect(html).toContain("Far")
		expect(html).toContain("Close")
		expect(html).toContain("Very close")
		expect(html).toContain("motion-reduce:transition-none")
	})

	it("uses Location on when no trend exists and keeps the empty meter before guidance", () => {
		const html = renderToStaticMarkup(
			<LocationDock
				{...live}
				state="on"
				guidanceEnabled
				hasAnswers={false}
				compass={{ state: "none", request: vi.fn() }}
			/>,
		)
		expect(html).toContain(">Location on</span>")
		expect(html).toContain("Finding which way to go. Keep this screen open and unlocked.")
		expect(html).not.toContain("bg-head")
		expect(html).toContain("Far")
	})

	it.each([
		["veryClose", "Look around, the place is right here. Keep this screen open and unlocked."],
		[
			"none",
			"This phone has no compass, so there's no arrow. Walk and watch the meter. Keep this screen open and unlocked.",
		],
		["refused", "The arrow needs motion access. Walk and watch the meter. Keep this screen open and unlocked."],
	] as const)("shows %s fallback without an arrow", (compassState, helper) => {
		const html = renderToStaticMarkup(
			<LocationDock
				{...live}
				state="on"
				guidanceEnabled
				guidance={{ band: compassState === "veryClose" ? "veryClose" : "far", bearing: 90, trend: "warmer" }}
				compass={{ state: compassState === "veryClose" ? "on" : compassState, heading: 0, request: vi.fn() }}
				hasAnswers={false}
			/>,
		)
		expect(html).toContain(helper.replaceAll("'", "&#x27;"))
		expect(html).not.toContain('class="size-8')
		expect(html).toContain('class="size-2.5 shrink-0 rounded-full bg-pace-ok')
		expect(html).toContain(">Warmer</span>")
	})

	it("asks iPhone players to show the arrow before compass permission", () => {
		const html = renderToStaticMarkup(
			<LocationDock
				{...live}
				state="on"
				guidanceEnabled
				compass={{ state: "needsTap", request: vi.fn() }}
				hasAnswers={true}
			/>,
		)
		expect(html).toContain("Arriving solves the quest. Keep this screen open and unlocked.")
		expect(html).toContain(">Show arrow</button>")
		expect(html).toContain("min-h-11")
		expect(html).toContain('placeholder="Code from the sign"')
		expect(html).toContain(">Send</button>")
	})

	it("does not show guidance when location is rough or guidance is disabled", () => {
		const rough = renderToStaticMarkup(
			<LocationDock
				{...live}
				state="rough"
				guidanceEnabled
				guidance={{ band: "far", bearing: 90, trend: "warmer" }}
				compass={{ state: "on", heading: 0, request: vi.fn() }}
				hasAnswers={false}
			/>,
		)
		const unguided = renderToStaticMarkup(
			<LocationDock {...live} state="on" guidance={{ band: "far", bearing: 90, trend: "warmer" }} hasAnswers={false} />,
		)
		expect(rough).toContain("GPS too rough")
		expect(rough).not.toContain(">Warmer</span>")
		expect(rough).not.toContain('class="size-8')
		expect(unguided).toContain("Walk to the place. Arriving solves the quest.")
		expect(unguided).not.toContain("Far")
		expect(unguided).not.toContain(">Warmer</span>")
	})

	it("keeps warmer guidance inert in previews", () => {
		const html = renderToStaticMarkup(
			<LocationDock
				preview
				guidanceEnabled
				guidance={{ band: "far", bearing: 90, trend: "warmer" }}
				compass={{ state: "needsTap", request: vi.fn() }}
				hasAnswers
			/>,
		)
		expect(html).toContain("Location off")
		expect(html).not.toContain("Show arrow")
		expect(html).not.toContain(">Warmer</span>")
		expect(html).toMatch(/<input[^>]*disabled=""/)
		expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Share location<\/button>/)
	})
})
