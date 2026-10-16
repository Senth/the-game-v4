import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { TeamHeader } from "./team-header"

it("renders phone-only team name and 44 px Teams back link without autosave", () => {
	const html = renderToStaticMarkup(<TeamHeader seasonId="season" name="Ninjas" />)
	expect(html).toContain("lg:hidden")
	expect(html).toContain('href="/admin/seasons/season/teams"')
	expect(html).toContain("‹ Teams")
	expect(html).toContain("min-h-11")
	expect(html).toContain("font-head text-head")
	expect(html).toContain("Ninjas")
	expect(html).not.toContain("Saved")
})

it("shows the team name as a desktop-only middle-pane heading", () => {
	const html = renderToStaticMarkup(<TeamHeader seasonId="season" name="Ninjas" />)
	const heading = html.match(/<h2 class="([^"]+)">Ninjas<\/h2>/)
	expect(heading).not.toBeNull()
	expect(heading?.[1]?.split(" ")).toEqual(
		expect.arrayContaining(["hidden", "lg:block", "font-head", "text-2xl", "text-head", "truncate"]),
	)
	expect(html).toMatch(/<header class="[^"]*lg:hidden">.*<h1[^>]*>Ninjas<\/h1><\/header>/)
})
