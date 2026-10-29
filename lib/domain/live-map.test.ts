import { describe, expect, it } from "vitest"
import { teamColor } from "./live-map"

describe("teamColor", () => {
	it.each([2, 10, 20])("spaces %s team hues evenly with stable output", (count) => {
		const colors = Array.from({ length: count }, (_, index) => teamColor(index, count))
		expect(new Set(colors).size).toBe(count)
		for (const [index, color] of colors.entries()) {
			expect(color).toBe(`hsl(${(index * 360) / count} 75% ${count > 10 && index % 2 ? 78 : 72}%)`)
			expect(teamColor(index, count)).toBe(color)
		}
	})
})
