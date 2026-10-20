import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { FinishRibbon } from "./finish-ribbon"
import { StandingsStrip } from "./standings-strip"

const notice = { teamId: "first", name: "Rävarna", place: 1, points: 50 }

it.each([
	[{ place: 2, points: 20 }, "2nd still open for +20p"],
	[null, "No bonus left"],
] as const)("shows next bonus %j with who, earnings, then availability", (nextBonus, line) => {
	for (const board of [false, true]) {
		const html = renderToStaticMarkup(
			<FinishRibbon notice={notice} nextBonus={nextBonus} closing={false} onDismiss={() => {}} board={board} />,
		)
		expect(html).toContain("Rävarna finished 1st")
		expect(html).toContain("+50p")
		expect(html).toContain(line)
		expect(html.indexOf("Rävarna finished 1st")).toBeLessThan(html.indexOf("+50p</span>"))
		expect(html.indexOf("+50p</span>")).toBeLessThan(html.indexOf(line))
		expect(html).toContain("border-pace-ok")
		expect(html).toContain("<button")
	}
})

it("cross-fades zero-point notice over strip without changing its height or navigating", () => {
	const html = renderToStaticMarkup(
		<StandingsStrip strip={[]} notice={{ ...notice, place: 3, points: 0 }} closing={false} onDismiss={() => {}} />,
	)
	expect(html).toContain("Rävarna finished 3rd")
	expect(html).toContain('aria-live="polite"')
	expect(html).toContain("absolute inset-0")
	expect(html).toContain('tabindex="-1"')
	expect(html).not.toContain("+0p")
})
