import { describe, expect, it } from "vitest"
import { formatTimeLeft } from "./clock"

describe("formatTimeLeft", () => {
	it("formats minute and hour clocks", () => {
		expect(formatTimeLeft(47 * 60_000 + 27_000)).toBe("47:27")
		expect(formatTimeLeft(1 * 3_600_000 + 47 * 60_000 + 27_000)).toBe("1:47:27")
	})

	it("floors partial seconds and clamps negative time at zero", () => {
		expect(formatTimeLeft(60_999)).toBe("1:00")
		expect(formatTimeLeft(-1)).toBe("0:00")
	})
})
