import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { useAutosave } from "./autosave-provider"
import { QuestHeader } from "./quest-header"

vi.mock("./autosave-provider", () => ({ useAutosave: vi.fn() }))

beforeEach(() => {
	vi.mocked(useAutosave).mockReturnValue(null)
})

it.each(["Harbour map", "The keeper's last log", null])("renders phone heading %s and an arc back link", (label) => {
	const html = renderToStaticMarkup(<QuestHeader seasonId="s1" arcTitle="Old Town" label={label} />)
	expect(html).toContain('class="lg:hidden"')
	expect(html).toContain('href="/admin/seasons/s1"')
	expect(html).toContain("‹ Old Town")
	expect(html).toContain((label ?? "Untitled quest").replaceAll("'", "&#x27;"))
	expect(html).toContain(label ? "font-head text-head" : "font-head text-muted")
	expect(html).toContain("min-h-11")
	expect(html).toContain("max-w-40")
	expect(html).not.toContain("Start now")
})

it("uses the empty arc fallback", () => {
	expect(renderToStaticMarkup(<QuestHeader seasonId="s1" arcTitle=" " label={null} />)).toContain("‹ Untitled arc")
})

it.each(["saved", "saving", "failed"] as const)("shows %s status at the right and marks failed header", (status) => {
	const retryAll = vi.fn()
	vi.mocked(useAutosave).mockReturnValue({
		seasonId: "s1",
		status,
		drafts: new Map(),
		update: vi.fn(),
		remove: vi.fn(),
		discard: vi.fn(),
		retryAll,
	})
	const html = renderToStaticMarkup(<QuestHeader seasonId="s1" arcTitle="Old Town" label="Harbour map" />)
	expect(html).toContain('class="shrink-0 pr-3"')
	expect(html.indexOf("Harbour map")).toBeLessThan(
		html.indexOf(status === "saved" ? "Saved" : status === "saving" ? "Saving…" : "Not saved,"),
	)
	expect(html).toContain(status === "failed" ? "border-warn" : "border-z1")
})
