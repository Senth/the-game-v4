import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { QuestAsset } from "./quest-asset"

it("renders nothing without an asset", () => {
	expect(renderToStaticMarkup(<QuestAsset assetPath={null} />)).toBe("")
})

it("shows a read-only thumbnail and muted shortened filename for an image", () => {
	const path = "/assets/3f9c1a7e-1234-5678-90ab-cdef12345678.png"
	const html = renderToStaticMarkup(<QuestAsset assetPath={path} />)
	expect(html).toContain(">Image</span>")
	expect(html).toContain("<img")
	expect(html).toContain(`src="${path}"`)
	expect(html).toContain('alt=""')
	expect(html).toContain("h-14 w-20 shrink-0 rounded-md object-cover")
	expect(html).toContain('class="truncate font-cond text-sm text-muted">3f9c1a7e.png')
	expect(html).not.toContain("<button")
	expect(html).not.toContain("<input")
	expect(html).not.toContain("<a ")
})

it.each(["pdf", "PDF"])("shows a PDF tile instead of a thumbnail for .%s", (extension) => {
	const html = renderToStaticMarkup(<QuestAsset assetPath={`/assets/12345678-rest.${extension}`} />)
	expect(html).toContain("bg-z1")
	expect(html).toContain(">PDF</span>")
	expect(html).toContain(`12345678.${extension}`)
	expect(html).not.toContain("<img")
})

it("does not expand a filename already shorter than eight characters", () => {
	expect(renderToStaticMarkup(<QuestAsset assetPath="/assets/log.png" />)).toContain(">log.png</span>")
})
