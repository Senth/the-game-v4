import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { MapViewProps } from "@/components/map/map-view"
import type { PlayerQuest, RailArc } from "@/lib/domain/game"
import { GameView } from "./game-view"
import { Intel } from "./intel"

vi.mock("@/app/actions", () => {
	throw new Error("GameView preview must not import server actions")
})
vi.mock("next/dynamic", async () => {
	const { PlaceMap } = await import("./place-map")
	return { default: () => PlaceMap }
})
vi.mock("@/components/map/lazy-map", () => ({
	default: ({ dot, circles, teammates }: MapViewProps) => (
		<div
			data-own-position={dot ? `${dot.lat},${dot.lng},${dot.accuracy}` : undefined}
			data-circles={JSON.stringify(circles)}
			data-teammates={JSON.stringify(teammates)}
		/>
	),
}))

const quest: PlayerQuest = {
	id: "quest-one",
	displayTitle: "First quest",
	content: "Read the clue.",
	assetPath: null,
	points: 50,
	drop: null,
	hintPenalty: 10,
	worth: 40,
	hints: [
		{ id: "locked-hint", position: 1, points: 5, revealed: false },
		{ id: "revealed-hint", position: 2, points: 10, text: "Previously revealed secret", revealed: true },
	],
}

const rail: RailArc[] = [{ arcId: "arc-one", segments: [{ questId: "quest-one", state: "current" }] }]

describe("GameView preview", () => {
	it.each([true, "team"] as const)(
		"shows all empty numbered map places without positions or subscriptions in preview=%s",
		(preview) => {
			const eventSource = vi.fn()
			vi.stubGlobal("EventSource", eventSource)
			try {
				const html = renderToStaticMarkup(
					<GameView
						timeLeftMs={0}
						pace={null}
						rail={rail}
						quest={{
							...quest,
							location: {
								guidance: "map",
								places: [
									{ lat: 55, lng: 13, radius: 40 },
									{ lat: 55.1, lng: 13, radius: 40 },
									{ lat: 55.2, lng: 13, radius: 40 },
								],
							},
							hasAnswers: false,
						}}
						preview={preview}
					/>,
				)
				expect(html.match(/&quot;held&quot;:false/g)).toHaveLength(3)
				for (const number of [1, 2, 3]) expect(html).toContain(`&quot;number&quot;:${number}`)
				expect(html.match(/· Empty/g)).toHaveLength(3)
				expect(html).toContain('data-teammates="[]"')
				expect(html).not.toContain("data-own-position=")
				expect(eventSource).not.toHaveBeenCalled()
			} finally {
				vi.unstubAllGlobals()
			}
		},
	)
	it.each([true, "team"] as const)("keeps location preview=%s Off and hides codes without answers", (preview) => {
		for (const hasAnswers of [true, false]) {
			const html = renderToStaticMarkup(
				<GameView
					timeLeftMs={0}
					pace={null}
					rail={rail}
					preview={preview}
					quest={{ ...quest, location: { guidance: "none" }, hasAnswers }}
				/>,
			)
			expect(html).toContain("Location off")
			expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Share location<\/button>/)
			expect(html.includes("<input")).toBe(hasAnswers)
			if (hasAnswers) expect(html).toContain('placeholder="Code from the sign"')
		}
	})
	it.each([true, false])("shows the puzzle answer dock only with answers=%s", (hasAnswers) => {
		const html = renderToStaticMarkup(
			<GameView
				timeLeftMs={0}
				pace={null}
				rail={rail}
				preview
				quest={{
					...quest,
					hasAnswers,
					puzzle: { rows: 2, cols: 2, aspect: 2, fullUrl: null, pieces: [{ id: "opaque", spot: { x: 0, y: 0 } }] },
				}}
			/>,
		)
		expect(html.includes('aria-label="Your answer"')).toBe(hasAnswers)
		expect(html).toContain('aria-label="Puzzle board"')
		expect(html).toContain("/api/puzzle/quest-one/opaque")
	})
	it.each([true, "team"] as const)("renders preview=%s links as plain readable content", (preview) => {
		const html = renderToStaticMarkup(
			<GameView
				timeLeftMs={60_000}
				pace={null}
				rail={rail}
				quest={{ ...quest, assetPath: "/assets/clue.pdf", content: '[Linked clue](/clue) <a href="/raw">Raw clue</a>' }}
				preview={preview}
			/>,
		)
		expect(html).toContain("Linked clue")
		expect(html).toContain("Raw clue")
		expect(html).toContain("Open PDF")
		expect(html).not.toContain("<a")
	})

	it.each([true, "team"] as const)("keeps audio, video and downloads inert in preview=%s", (preview) => {
		for (const extension of ["mp3", "mp4", "zip"]) {
			const html = renderToStaticMarkup(
				<GameView
					timeLeftMs={60_000}
					pace={null}
					rail={rail}
					quest={{ ...quest, assetPath: `/assets/clue.${extension}` }}
					preview={preview}
				/>,
			)
			expect(html).toMatch(/<section inert="">[\s\S]*<\/section>/)
			expect(html).toContain(extension === "zip" ? "↓ Download ZIP</span>" : `src="/assets/clue.${extension}"`)
			expect(html).not.toContain("<a ")
			expect(html).not.toContain('download=""')
		}
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
		expect(html).not.toContain("Team menu")
	})

	it("renders no team menu in the admin team preview", () => {
		const html = renderToStaticMarkup(
			<GameView
				timeLeftMs={60_000}
				pace={{ band: "pace-2", label: "3 behind" }}
				rail={rail}
				strip={[{ kind: "team", rank: 1, id: "team", name: "Ninjas", score: 50, you: true }]}
				quest={quest}
				preview="team"
			/>,
		)
		expect(html).toContain("3 behind")
		expect(html).not.toContain("Team menu")
		expect(html).not.toContain("Invite a teammate")
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

it("shows map guidance helper and forwards the rough own fix to its map", () => {
	const html = renderToStaticMarkup(
		<GameView
			timeLeftMs={0}
			pace={null}
			rail={rail}
			quest={{
				...quest,
				location: { guidance: "map", places: [{ lat: 55.5, lng: 13.2, radius: 40 }] },
				hasAnswers: false,
			}}
			locationStatus={{ state: "rough", accuracy: 95, position: { lat: 55.501, lng: 13.201, accuracy: 95 } }}
			answer=""
			onAnswerChange={() => {}}
			onSubmit={() => {}}
			pending={false}
			feedback={null}
			onReveal={async () => {}}
			decrypting={new Set()}
			onDecryptComplete={() => {}}
		/>,
	)
	expect(html).toContain('data-own-position="55.501,13.201,95"')
	expect(html).toContain("GPS too rough")
	expect(html).toContain("Step out into the open and wait a few seconds. The game keeps trying.")
})
