import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PlayerHint, PlayerQuest } from "@/lib/domain/game"
import { AnswerDock, type AnswerFeedback } from "./answer-dock"
import { Intel } from "./intel"

const intelProps = { decrypting: new Set<string>(), onDecryptComplete: vi.fn() }

describe("Intel", () => {
	it("shows current/full worth and revealed text with a right-aligned penalty", () => {
		const hints: PlayerHint[] = [
			{ id: "first", position: 1, points: 5, text: "Start from the bottom.", revealed: true },
		]
		const html = renderToStaticMarkup(
			<Intel {...intelProps} quest={{ worth: 35, points: 50, drop: null, hintPenalty: 0, hints }} onReveal={vi.fn()} />,
		)
		expect(html).toContain('text-head">35p</span>')
		expect(html).toContain('text-muted"> / 50p</span>')
		expect(html).toContain("Start from the bottom.")
		expect(html).toContain('text-warn">−5p</span>')
		expect(html).toContain("justify-between")
		expect(html).toContain(">01</span>")
		expect(html).not.toContain("sr-only")
	})

	it("never renders text from a locked hint, even if extra text reaches the component", () => {
		const hint = { id: "locked", position: 2, points: 10, revealed: false as const, text: "Unrevealed secret" }
		const html = renderToStaticMarkup(
			<Intel
				{...intelProps}
				quest={{ worth: 40, points: 50, drop: null, hintPenalty: 0, hints: [hint] }}
				onReveal={vi.fn()}
			/>,
		)
		expect(html).not.toContain(hint.text)
		expect(html).toContain("Hold to decrypt")
		expect(html).toContain('text-muted">−10p</span>')
		expect(html).toContain('type="button"')
		expect(html).toContain("min-h-11")
		expect(html).toContain("touch-none select-none")
	})

	it("keeps negative worth without clamping it", () => {
		const html = renderToStaticMarkup(
			<Intel
				{...intelProps}
				quest={{ worth: -5, points: 10, drop: null, hintPenalty: 0, hints: [] }}
				onReveal={vi.fn()}
			/>,
		)
		expect(html).toContain('text-head">-5p</span>')
	})
})

describe("Intel time bonus", () => {
	const reachedAt = Date.parse("2026-10-31T12:00:00Z")
	const quest: Pick<PlayerQuest, "worth" | "points" | "hints" | "drop" | "hintPenalty"> = {
		worth: 15,
		points: 20,
		drop: { fullMinutes: 10, dropMinutes: 20, floor: 5, reachedAt },
		hintPenalty: 5,
		hints: [],
	}

	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	function renderAt(elapsedMs: number, overrides: Partial<typeof quest> = {}) {
		vi.setSystemTime(reachedAt + elapsedMs)
		return renderToStaticMarkup(
			<Intel {...intelProps} quest={{ ...quest, ...overrides }} now={new Date()} onReveal={vi.fn()} />,
		)
	}

	it("shows the first deduction before the drop", () => {
		const html = renderAt(348_000)
		expect(html).toContain('text-head">15p</span>')
		expect(html).toContain("14p in 5:32")
		expect(html).toContain('text-pace-ok">+15p</span>')
	})

	it("updates worth and countdown at the first deduction and mid-drop", () => {
		const firstDeduction = renderAt(680_000)
		expect(firstDeduction).toContain('text-head">14p</span>')
		expect(firstDeduction).toContain("13p in 1:20")
		expect(firstDeduction).toContain('text-pace-ok">+14p</span>')

		const midDrop = renderAt(878_000)
		expect(midDrop).toContain('text-head">12p</span>')
		expect(midDrop).toContain("11p in 0:42")
		expect(midDrop).toContain('text-pace-ok">+12p</span>')
	})

	it.each([1_800_000, 2_400_000])("shows zero bonus without a countdown at %i ms", (elapsedMs) => {
		const html = renderAt(elapsedMs)
		expect(html).toContain('text-head">0p</span>')
		expect(html).toContain('text-muted">+0p</span>')
		expect(html).not.toContain(" in ")
	})

	it("keeps negative header worth separate from non-negative bonus", () => {
		const html = renderAt(0, { hintPenalty: 100 })
		expect(html).toContain('text-head">-80p</span>')
		expect(html).toContain('text-pace-ok">+15p</span>')
		expect(html).not.toContain('text-pace-ok">-')
	})

	it.each<[string, typeof quest]>([
		["no drop", { ...quest, drop: null }],
		["no positive bonus", { ...quest, drop: { fullMinutes: 10, dropMinutes: 20, floor: 20, reachedAt } }],
	])("omits the row for %s", (_name, timedQuest) => {
		const html = renderToStaticMarkup(
			<Intel {...intelProps} quest={timedQuest} now={new Date(reachedAt)} onReveal={vi.fn()} />,
		)
		expect(html).not.toContain("Time bonus")
	})

	it("shares hint number slot and keeps countdown compact", () => {
		const html = renderAt(348_000, {
			hints: [{ id: "revealed", position: 1, points: 5, text: "Clue", revealed: true }],
		})
		expect(html).toContain('<span class="relative mr-2 font-cond text-muted"><span class="invisible">01</span><svg')
		expect(html).toContain('<span class="mr-2 font-cond text-muted">01</span>')
		expect(html).toContain("shrink-0 items-baseline gap-3 font-cond tabular-nums")
		expect(html).toContain("text-xs text-muted")
	})
})

const dockProps = { answer: "lighthouse", onAnswerChange: vi.fn(), onSubmit: vi.fn(), pending: false, feedback: null }

describe("AnswerDock", () => {
	it("reserves its 28px feedback line even when empty and keeps controls at least 44px", () => {
		const html = renderToStaticMarkup(<AnswerDock {...dockProps} />)
		expect(html).toContain("fixed inset-x-0 bottom-0")
		expect(html).toContain("border-t border-z2 bg-z1")
		expect(html).toContain("max-w-2xl")
		expect(html).toContain("h-7")
		expect(html).toContain("env(safe-area-inset-bottom)")
		expect(html).toContain('maxLength="200"')
		expect(html).toContain('placeholder="Your answer"')
		expect(html).toMatch(/<input[^>]*class="h-12 /)
		expect(html).toMatch(/<button[^>]*class="h-12 /)
	})

	it.each(["", "   ", "\n\t"])("disables Send for trimmed-empty answer %j", (answer) => {
		const html = renderToStaticMarkup(<AnswerDock {...dockProps} answer={answer} />)
		expect(html).toMatch(/<button[^>]*disabled=""/)
	})

	it("disables Send in flight", () => {
		const html = renderToStaticMarkup(<AnswerDock {...dockProps} pending />)
		expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"/)
	})

	it("enables Send for a nonempty answer", () => {
		const html = renderToStaticMarkup(<AnswerDock {...dockProps} />)
		expect(html).not.toMatch(/<button[^>]* disabled=/)
	})

	it("shows mutation failures in the existing reserved line without losing the answer", () => {
		const html = renderToStaticMarkup(
			<AnswerDock {...dockProps} feedback={{ id: 1, kind: "error", message: "Could not send. Try again." }} />,
		)
		expect(html).toContain("Could not send. Try again.")
		expect(html).toContain('value="lighthouse"')
		expect(html).toContain("border-warn ring-warn/40")
	})

	it("truncates a 200-character wrong answer inside the quotes and retains the input", () => {
		const answer = "x".repeat(200)
		const html = renderToStaticMarkup(
			<AnswerDock {...dockProps} answer={answer} feedback={{ id: 1, kind: "wrong", answer }} />,
		)
		expect(html).toContain(
			`<span class="shrink-0">&quot;</span><span class="min-w-0 truncate">${answer}</span><span class="shrink-0">&quot; is not it.</span>`,
		)
		expect(html).toContain(`value="${answer}"`)
		expect(html).toContain("border-warn ring-warn/40")
		expect(html.match(/animate-\[answer-feedback_4s_linear_forwards\]/g)).toHaveLength(2)
	})

	it.each<{ feedback: AnswerFeedback; message: string }>([
		{ feedback: { id: 2, kind: "correct", points: 35 }, message: "Solved. +35p" },
		{ feedback: { id: 3, kind: "correct", points: null }, message: "Solved." },
		{ feedback: { id: 4, kind: "correct", points: -5 }, message: "Solved. -5p" },
	])("shows success feedback $message", ({ feedback, message }) => {
		const html = renderToStaticMarkup(<AnswerDock {...dockProps} feedback={feedback} />)
		expect(html).toContain(message)
		expect(html).toContain("border-pace-ok ring-pace-ok/40")
		expect(html).toContain("text-pace-ok")
		expect(html).not.toContain("border-warn")
	})
})
