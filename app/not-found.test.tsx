import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import NotFound from "./not-found"

it("renders a quiet dark not-found sentence and one 44 px link home", () => {
	const html = renderToStaticMarkup(<NotFound />)
	expect(html).toMatch(/<main[^>]*min-h-dvh[^>]*bg-z0[^>]*>/)
	expect(html).toMatch(/<p[^>]*text-muted[^>]*>Page not found\.<\/p>/)
	expect(html).toMatch(/<a[^>]*h-11[^>]*text-link[^>]*href="\/"[^>]*>Back to the game ›<\/a>/)
	expect(html).toContain("focus-visible:outline-accent")
	expect(html.match(/<a\b/g)).toHaveLength(1)
	expect(html).not.toMatch(/<h[1-6]\b|<button\b|dark:|prefers-color-scheme/)
})
