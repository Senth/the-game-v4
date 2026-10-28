import { afterEach, describe, expect, it, vi } from "vitest"
import { PhoneName, randomPhoneName, samePhoneName } from "./phone-names"

afterEach(() => vi.restoreAllMocks())

describe("phone names", () => {
	it("trims, normalizes and accepts both length bounds", () => {
		expect(PhoneName.parse("  A  ")).toBe("A")
		expect(PhoneName.parse(` ${"a".repeat(20)} `)).toHaveLength(20)
		expect(PhoneName.parse(" Cafe\u0301 ")).toBe("Café")
		for (const name of ["", "   ", "a".repeat(21)]) expect(PhoneName.safeParse(name).success).toBe(false)
	})

	it("compares normalized names ignoring case but not accents", () => {
		expect(samePhoneName("  Bright Owl ", "bright owl")).toBe(true)
		expect(samePhoneName("Café", "CAFE\u0301")).toBe(true)
		expect(samePhoneName("Cafe", "Café")).toBe(false)
	})

	it("skips taken names ignoring case even when randomness repeats", () => {
		vi.spyOn(Math, "random").mockReturnValue(0)
		const first = randomPhoneName([])
		expect(first).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
		const second = randomPhoneName([first.toLowerCase()])
		expect(samePhoneName(first, second)).toBe(false)
		expect(PhoneName.safeParse(second).success).toBe(true)
	})

	it("uses a valid numeric suffix when every word pair is taken", () => {
		vi.spyOn(Math, "random").mockReturnValue(0)
		const taken: string[] = []
		for (let i = 0; i < 32 * 32; i++) taken.push(randomPhoneName(taken))
		expect(taken.every((name) => !/\d/.test(name))).toBe(true)
		const fallback = randomPhoneName(taken)
		expect(fallback).toMatch(/\d+$/)
		expect(PhoneName.safeParse(fallback).success).toBe(true)
		expect(randomPhoneName([...taken, fallback])).not.toBe(fallback)
	})
})
