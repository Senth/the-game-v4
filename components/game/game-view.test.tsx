import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { PlayerQuest, RailArc } from "@/lib/domain/game"
import { GameView } from "./game-view"
import { Intel } from "./intel"

vi.mock("@/app/actions", () => {
	throw new Error("GameView preview must not import server actions")
})

const quest: PlayerQuest = {
	id: "quest-one",
	displayTitle: "First quest",
	content: "Read the clue.",
	assetPath: null,
	points: 50,
	worth: 40,
	hints: [
		{ id: "locked-hint", position: 1, points: 5, revealed: false },
		{ id: "revealed-hint", position: 2, points: 10, text: "Previously revealed secret", revealed: true },
	],
}

const rail: RailArc[] = [{ arcId: "arc-one", segments: [{ questId: "quest-one", state: "current" }] }]

describe("GameView preview", () => {
	it("renders team preview links as plain readable content without disabling frame scrolling", () => {
		const html = renderToStaticMarkup(
			<GameView
				timeLeftMs={60_000}
				pace={null}
				rail={rail}
				quest={{ ...quest, assetPath: "/assets/clue.pdf", content: '[Linked clue](/clue) <a href="/raw">Raw clue</a>' }}
				preview="team"
			/>,
		)
		expect(html).toContain("Linked clue")
		expect(html).toContain("Raw clue")
		expect(html).toContain("Open PDF")
		expect(html).not.toContain("<a")
	})

	it("renders player content with inert dock controls and no standings link", () => {
		const html = renderToStaticMarkup(
			<GameView
				timeLeftMs={60_000}
				pace={{ band: "pace-2", label: "3 behind" }}
				rail={rail}
				strip={[{ kind: "team", rank: 1, id: "team", name: "Ninjas", score: 50, you: true }]}
				quest={quest}
				preview
			/>,
		)

		expect(html).toContain("First quest")
		expect(html).toContain('aria-label="Your answer"')
		expect(html).toMatch(/<input[^>]*disabled=""/)
		expect(html).toMatch(/<button[^>]*disabled=""/)
		expect(html).not.toContain("/standings")
		expect(html).not.toContain("3 behind")
		expect(html).not.toContain("Ninjas")
	})

	it("keeps every hint locked without hidden text, progress fill or reveal controls", () => {
		const html = renderToStaticMarkup(<Intel quest={quest} preview />)

		expect(html.match(/Hold to decrypt/g)).toHaveLength(2)
		expect(html).toContain("01")
		expect(html).toContain("02")
		expect(html).toContain("−5p")
		expect(html).toContain("−10p")
		expect(html).not.toContain("Previously revealed secret")
		expect(html).not.toContain("bg-link/15")
		expect(html).not.toContain('type="button"')
	})

	it("keeps the waiting branch without an answer dock", () => {
		const html = renderToStaticMarkup(<GameView timeLeftMs={0} pace={null} rail={rail} quest={null} preview />)

		expect(html).toContain("Waiting for a quest.")
		expect(html).not.toContain('aria-label="Your answer"')
	})
})
