import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { PaceBand, RailArc, StripEntry } from "@/lib/domain/game"
import { ArcRail } from "./arc-rail"
import { GameHeader } from "./game-header"
import { QuestContent } from "./quest-content"
import { StandingsStrip } from "./standings-strip"

const rail: RailArc[] = [
	{
		arcId: "lighthouse",
		segments: [
			{ questId: "log", state: "solved" },
			{ questId: "horn", state: "current" },
		],
	},
	{ arcId: "finale", segments: [{ questId: "vault", state: "todo" }] },
]
const strip: StripEntry[] = [
	{ kind: "team", id: "foxes", rank: 1, name: "Rävarna", score: 120, you: false },
	{ kind: "gap" },
	{ kind: "team", id: "lagom", rank: 6, name: "Lagom", score: 70, you: false },
	{ kind: "team", id: "ninjas", rank: 7, name: "Ninjas", score: 64, you: true },
]
const quest = { displayTitle: "The keeper's last log", assetPath: null, content: "Read the log." }

describe("QuestContent", () => {
	it.each([false, true])("omits empty and whitespace titles in player and admin preview=%s", (preview) => {
		for (const displayTitle of ["", " \t\n"]) {
			const html = renderToStaticMarkup(
				<QuestContent quest={{ displayTitle, content: "", assetPath: "/assets/clue.png" }} preview={preview} />,
			)
			expect(html).not.toContain("<h1")
			expect(html).not.toContain("mb-4")
			expect(html).toContain('src="/assets/clue.png"')
		}
		const html = renderToStaticMarkup(<QuestContent quest={quest} preview={preview} />)
		expect(html).toMatch(/<h1[^>]*>The keeper&#x27;s last log<\/h1>/)
	})

	it("renders Markdown and trusted raw HTML", () => {
		const html = renderToStaticMarkup(
			<QuestContent
				quest={{
					...quest,
					content: '**Read** <span data-clue="last">the log</span>.\n\n<div class="clue">Raw clue</div>',
				}}
			/>,
		)
		expect(html).toContain("<strong>Read</strong>")
		expect(html).toContain('<span data-clue="last">the log</span>')
		expect(html).toContain('<div class="clue">Raw clue</div>')
	})

	it.each([false, true])("makes authored forms, inputs and buttons inert only in team preview=%s", (preview) => {
		const content = '<form action="/leave-admin"><input name="clue" /><button type="submit">Try clue</button></form>'
		const html = renderToStaticMarkup(<QuestContent quest={{ ...quest, content }} preview={preview} />)
		expect(html).toContain('<form action="/leave-admin">')
		expect(html).toContain('<input name="clue"/>')
		expect(html).toContain('<button type="submit">Try clue</button>')
		if (preview) expect(html).toMatch(/^<section inert="">/)
		else expect(html).not.toContain('inert=""')
	})

	it.each(["javascript", "", "unknown-language"])("renders a plain pre before lazy highlighting for %s", (language) => {
		const html = renderToStaticMarkup(
			<QuestContent quest={{ ...quest, content: `\`\`\`${language}\nconst clue = "<log>"\n\`\`\`` }} />,
		)
		expect(html).toContain("<pre><code")
		expect(html).toContain("const clue = &quot;&lt;log&gt;&quot;")
		expect(html).not.toContain('class="shiki')
	})

	it("keeps inline code inline", () => {
		const html = renderToStaticMarkup(<QuestContent quest={{ ...quest, content: "Read `clue`." }} />)
		expect(html).toContain("<code>clue</code>")
		expect(html).not.toContain("<pre")
	})

	it("preserves asset image aspect ratio rather than cropping", () => {
		const html = renderToStaticMarkup(<QuestContent quest={{ ...quest, assetPath: "/assets/log.png" }} />)
		expect(html).toContain('src="/assets/log.png"')
		expect(html).toContain("max-h-[70vh]")
		expect(html).toContain("object-contain")
		expect(html).not.toContain("object-cover")
		expect(html).not.toContain("aspect-")
	})

	it("renders PDFs as a quiet link, not an image", () => {
		const html = renderToStaticMarkup(<QuestContent quest={{ ...quest, assetPath: "/assets/log.pdf" }} />)
		expect(html).toContain('href="/assets/log.pdf"')
		expect(html).toContain("Open PDF</a>")
		expect(html).not.toContain("<img")
	})

	it.each([false, true])("renders each asset kind with inert preview=%s", (preview) => {
		for (const extension of ["jpg", "png", "svg", "pdf", "mp3", "m4a", "ogg", "wav", "mp4", "webm", "zip", "bin"]) {
			const assetPath = `/assets/clue.${extension}`
			const html = renderToStaticMarkup(<QuestContent quest={{ ...quest, assetPath }} preview={preview} />)
			expect(html.includes('inert=""')).toBe(preview)
			if (["jpg", "png", "svg"].includes(extension)) {
				expect(html).toContain(`<img src="${assetPath}"`)
			} else if (extension === "pdf") {
				expect(html).toContain(`Open PDF</${preview ? "span" : "a"}>`)
				expect(html.includes(`href="${assetPath}"`)).toBe(!preview)
			} else if (["mp3", "m4a", "ogg", "wav"].includes(extension)) {
				expect(html).toContain(`<audio`)
				expect(html).toContain(`src="${assetPath}"`)
				expect(html).toContain('preload="metadata"')
				expect(html).toContain('aria-label="Play audio"')
				expect(html).toContain('type="range"')
			} else if (["mp4", "webm"].includes(extension)) {
				expect(html).toContain(`<video src="${assetPath}" controls="" preload="metadata"`)
				expect(html).toContain("max-h-[70vh] w-full rounded-md")
			} else {
				expect(html).toContain(`↓ Download ${extension === "bin" ? "file" : "ZIP"}</${preview ? "span" : "a"}>`)
				expect(html.includes(`href="${assetPath}"`)).toBe(!preview)
				expect(html.includes('download=""')).toBe(!preview)
				expect(html).toContain("h-11 w-full")
			}
			if (!["jpg", "png", "svg"].includes(extension)) expect(html).not.toContain("<img")
		}
	})
})

describe("G2 header and strip", () => {
	it.each<PaceBand>(["pace-ok", "pace-1", "pace-2", "pace-3"])("pairs clock and label with %s", (band) => {
		const html = renderToStaticMarkup(
			<GameHeader timeLeftMs={2847000} pace={{ band, label: "2 behind" }} rail={rail} strip={strip} />,
		)
		expect(html).toContain(`text-lg text-${band}">47:27`)
		expect(html).toContain(`text-xs text-${band}">2 behind`)
		expect(html).toContain("sticky top-0 z-10 bg-z0")
		expect(html).not.toMatch(/quest \d+ of \d+/i)
		expect(html).not.toContain("Log out")
	})

	it("renders missing pace without claiming an on-pace state", () => {
		const html = renderToStaticMarkup(<GameHeader timeLeftMs={0} pace={null} rail={[]} strip={[]} />)
		expect(html).toContain("0:00")
		expect(html).not.toContain("On pace")
	})

	it("keeps authored positions, state colors and proportional arc widths", () => {
		const html = renderToStaticMarkup(<ArcRail rail={[...rail, { arcId: "empty", segments: [] }]} />)
		expect(html.indexOf("bg-pace-ok")).toBeLessThan(html.indexOf("bg-accent"))
		expect(html.indexOf("bg-accent")).toBeLessThan(html.indexOf("bg-z2/60"))
		expect(html).toContain('style="flex:2"')
		expect(html).toContain('style="flex:1"')
		expect(html).not.toContain('style="flex:0"')
		expect(html).toContain('aria-current="step"')
		expect(html).toContain("ring-2 ring-accent/40")
	})

	it("makes the whole quiet strip one 44px standings link", () => {
		const html = renderToStaticMarkup(<StandingsStrip strip={strip} />)
		expect(html.match(/<a /g)).toHaveLength(1)
		expect(html).toContain('href="/standings"')
		expect(html).toContain("min-h-11")
		expect(html).toContain("···")
		expect(html).toContain("rounded bg-accent/20")
		expect(html).toContain('class="truncate text-ink">Ninjas')
		expect(html).toContain('font-bold tabular-nums text-head">64')
		expect(html).toContain("All ›")
	})
})
