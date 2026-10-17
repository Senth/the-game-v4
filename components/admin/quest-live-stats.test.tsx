import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import type { QuestLiveStats } from "@/lib/domain/quest-stats"
import { QuestCompletion, QuestLiveStatsBlock } from "./quest-live-stats"

const stats: QuestLiveStats = {
	done: 7,
	total: 10,
	completedBy: ["Team Kaos", "Rävarna"],
	hintRevealers: { h1: ["Ninjas", "Lagom"] },
}
const hints = [
	{ id: "h2", text: "Count the seconds.", points: 10 },
	{ id: "h1", text: "Dots are short.", points: 5 },
]

it("renders completion with a quiet count and handles no eligible teams", () => {
	const html = renderToStaticMarkup(<QuestCompletion stats={stats} />)
	expect(html).toContain("7/10 done")
	expect(html).toContain("width:70%")
	expect(html).toContain("bg-pace-ok")
	const empty = renderToStaticMarkup(<QuestCompletion stats={{ ...stats, done: 0, total: 0 }} />)
	expect(empty).toContain("0/0 done")
	expect(empty).toContain("width:0%")
})

it("keeps solver and revealer chip order and current hints in authored order", () => {
	const html = renderToStaticMarkup(
		<QuestLiveStatsBlock stats={stats} hints={hints} editHref="/admin/seasons/s1/quests/q1" />,
	)
	expect(html.indexOf("Team Kaos")).toBeLessThan(html.indexOf("Rävarna"))
	expect(html.indexOf("Ninjas")).toBeLessThan(html.indexOf("Lagom"))
	expect(html.indexOf("Count the seconds.")).toBeLessThan(html.indexOf("Dots are short."))
	expect(html).toMatch(/text-muted[^>]*>−10p/)
	expect(html).toMatch(/text-warn[^>]*>−5p/)
	expect(html).toContain("Not revealed yet")
	expect(html).toMatch(/class="[^"]*bg-pace-ok\/15[^"]*text-pace-ok"/)
	expect(html).toMatch(/class="[^"]*bg-z2[^"]*font-cond text-xs"/)
	expect(html).toContain("bg-z1/50")
	expect(html).toMatch(/<a[^>]*href="\/admin\/seasons\/s1\/quests\/q1"[^>]*>Edit quest ›<\/a>/)
	expect(html).toContain("h-11")
})

it("shows empty solver copy and leaves out hints when the quest has none", () => {
	const html = renderToStaticMarkup(
		<QuestLiveStatsBlock stats={{ ...stats, completedBy: [] }} hints={[]} editHref="/admin/seasons/s1/quests/q1" />,
	)
	expect(html).toContain("Completed by")
	expect(html).toContain("Nobody yet")
	expect(html).not.toContain(">Hints<")
	expect(html).not.toContain("Not revealed yet")
})

it("leaves out the edit link when no editor destination is supplied", () => {
	const html = renderToStaticMarkup(<QuestLiveStatsBlock stats={stats} hints={hints} />)
	expect(html).toContain("Completed by")
	expect(html).not.toContain("Edit quest")
	expect(html).not.toContain("<a")
})
