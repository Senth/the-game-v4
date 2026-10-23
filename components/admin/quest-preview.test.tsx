import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { useDraftHints, useDraftValue } from "./autosave-provider"
import { QuestPreview } from "./quest-preview"
import { usePuzzlePreviewAssets } from "./use-puzzle-preview-assets"
import { useSeasonClock } from "./use-season-clock"

vi.mock("./autosave-provider", () => ({ useDraftValue: vi.fn(), useDraftHints: vi.fn() }))
vi.mock("./use-season-clock", () => ({ useSeasonClock: vi.fn() }))
vi.mock("./use-puzzle-preview-assets", () => ({ usePuzzlePreviewAssets: vi.fn() }))

const now = Date.parse("2026-10-15T18:00:00Z")
const quest = {
	id: "quest",
	displayTitle: "Saved title",
	content: "Saved content",
	assetPath: null,
	points: 20,
	hints: [{ id: "hint", text: "Hidden hint text", points: 5 }],
	location: null,
	internalTitle: "Secret internal title",
	adminNotes: "Secret admin notes",
	answers: ["Secret answer"],
}
const season = {
	start: new Date(now - 60_000),
	end: new Date(now + 120_000),
	lengthMinutes: 60,
	arcs: [{ id: "arc", title: "Arc", shuffleQuests: false, quests: [quest] }],
}
const props = { season, arcId: "arc", quest, now }

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(useDraftValue).mockImplementation((_target, value) => value)
	vi.mocked(useDraftHints).mockImplementation((_target, value) => value)
	vi.mocked(useSeasonClock).mockReturnValue(now)
	vi.mocked(usePuzzlePreviewAssets).mockReturnValue(undefined)
})

it("uses unsaved puzzle dimensions and a deterministic inert spread without an answer dock", () => {
	vi.mocked(useDraftValue).mockImplementation((target, value) =>
		target.field === "puzzle" ? { rows: 2, cols: 2, showFull: false } : target.field === "answers" ? [] : value,
	)
	vi.mocked(usePuzzlePreviewAssets).mockReturnValue({
		ids: ["d", "c", "b", "a"],
		aspect: 2,
		fullUrl: "/api/puzzle/quest/full",
	})
	const view = () =>
		renderToStaticMarkup(<QuestPreview {...props} quest={{ ...quest, assetPath: "/assets/chart.png" }} />)
	const html = view()
	expect(html).toBe(view())
	expect(html).toContain('aria-label="Puzzle board" inert=""')
	expect(html).toContain("/api/puzzle/quest/a")
	expect(html).not.toContain("/assets/chart.png")
	expect(html).not.toContain('aria-label="Your answer"')
})

it("renders live drafts through the real player components without leaking admin fields or hidden hints", () => {
	const drafts: Record<string, unknown> = {
		displayTitle: "Unsaved title",
		content: "**Unsaved content**",
		points: 40,
		assetPath: "/assets/upload.png",
	}
	vi.mocked(useDraftValue).mockImplementation((target, value) => drafts[target.field] ?? value)
	vi.mocked(useDraftHints).mockReturnValue([{ id: "hint", text: "Unsaved hidden hint", points: 13 }])
	const html = renderToStaticMarkup(<QuestPreview {...props} frame />)
	expect(html).toContain("Unsaved title")
	expect(html).toContain("<strong>Unsaved content</strong>")
	expect(html).toContain('src="/assets/upload.png"')
	expect(html).toContain("40p")
	expect(html).toContain("−13p")
	for (const secret of [
		quest.internalTitle,
		quest.adminNotes,
		...quest.answers,
		"Hidden hint text",
		"Unsaved hidden hint",
		"Saved content",
		"Saved title",
	]) {
		expect(html).not.toContain(secret)
	}
	expect(html).toContain("Player preview")
	expect(html).toContain("rounded-[28px] border-4 border-z2")
	expect(html).toContain("h-[844px] w-[390px] origin-top-left scale-[0.82]")
	expect(html).toMatch(/<input[^>]*disabled=""/)
	expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send/)
	expect(html).not.toContain("/standings")
	expect(html).not.toContain("On pace")
})

it("uses the draft location in the player preview", () => {
	const location = { guidance: "none" as const, places: [{ id: "secret-place", lat: 55, lng: 13, radius: 40 }] }
	vi.mocked(useDraftValue).mockImplementation((target, value) => (target.field === "location" ? location : value))
	const html = renderToStaticMarkup(<QuestPreview {...props} quest={{ ...quest, answers: [], location: null }} />)
	expect(useDraftValue).toHaveBeenCalledWith({ arcId: "arc", questId: "quest", field: "location" }, null)
	expect(html).not.toContain('aria-label="Your answer"')
	expect(html).not.toContain("secret-place")
})

it("uses the local clock without adding a frame to the unframed variant", () => {
	vi.mocked(useSeasonClock).mockReturnValue(now + 1000)
	const html = renderToStaticMarkup(<QuestPreview {...props} />)
	expect(useSeasonClock).toHaveBeenCalledWith(now, season.start, season.end)
	expect(html).toContain("1:59")
	expect(html).not.toContain("Player preview")
	expect(html).not.toContain("scale-[0.82]")
})
