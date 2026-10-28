import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { TeamPhones } from "./team-phones"

const now = new Date("2026-10-28T17:00:00Z")
const phones = [
	{ name: "Quiet Fox", lastSeenAt: new Date(now.getTime() - 1_000) },
	{ name: "Brave Owl", lastSeenAt: new Date(now.getTime() - 600_001) },
	{ name: "Ben", lastSeenAt: now },
	{ name: "Kim", lastSeenAt: new Date(now.getTime() - 600_000) },
]

it("lists here phones first by name, then marks away phones muted", () => {
	const html = renderToStaticMarkup(<TeamPhones phones={phones} now={now} />)

	expect(html.indexOf("Ben")).toBeLessThan(html.indexOf("Kim"))
	expect(html.indexOf("Kim")).toBeLessThan(html.indexOf("Quiet Fox"))
	expect(html.indexOf("Quiet Fox")).toBeLessThan(html.indexOf("Brave Owl away"))
	expect(html).toContain('<span class="text-muted">Brave Owl away</span>')
	expect(html).not.toContain('class="text-muted">Kim')
})

it("shows muted phone count", () => {
	const html = renderToStaticMarkup(<TeamPhones phones={phones} now={now} />)

	expect(html).toContain('<span class="font-cond text-xs text-muted">4 phones</span>')
})

it("shows quiet empty state", () => {
	const html = renderToStaticMarkup(<TeamPhones phones={[]} now={now} />)

	expect(html).toContain("No phones yet")
	expect(html).toContain("0 phones")
})
