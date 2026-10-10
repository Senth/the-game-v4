import { describe, expect, it } from "vitest"
import { scrambleFrame } from "./scramble"

describe("scrambleFrame", () => {
	it("scrambles every non-space position at progress zero", () => {
		const target = "A quick fox"
		const frame = scrambleFrame(target, 0, () => 0)

		expect([...frame]).toHaveLength([...target].length)
		for (const [index, character] of [...target].entries()) {
			if (character !== " ") expect([...frame][index]).not.toBe(character)
		}
	})

	it("keeps the first progressed characters and preserves spaces", () => {
		const target = "A quick fox"
		const progress = 0.5
		const frame = scrambleFrame(target, progress, () => 0)

		expect(frame.slice(0, Math.floor(progress * target.length))).toBe(
			target.slice(0, Math.floor(progress * target.length)),
		)
		for (const [index, character] of [...target].entries()) {
			if (character === " ") expect([...frame][index]).toBe(" ")
		}
	})

	it("returns the target at progress one", () => {
		expect(scrambleFrame("The answer", 1, () => 0)).toBe("The answer")
	})

	it("uses the prototype glyph set", () => {
		const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&*@$"
		let index = 0
		expect(scrambleFrame("?".repeat(glyphs.length), 0, () => index++ / glyphs.length)).toBe(glyphs)
	})
})
