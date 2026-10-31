import { describe, expect, it } from "vitest"
import { livePlaces, teamColor } from "./live-map"
import { type Location, Team } from "./schemas"
import { newQuest } from "./season-tree"

const place = { id: "place-secret", lat: 55.5, lng: 13.2, radius: 40 }
const quest = (id: string, guidance: Location["guidance"] = "map", count = 1) => ({
	...newQuest(20),
	id,
	location: {
		guidance,
		places: Array.from({ length: count }, (_, index) => ({
			...place,
			id: `${place.id}-${index}`,
			lat: place.lat + index,
		})),
	},
})
const season = (quests: ReturnType<typeof newQuest>[]) => ({
	arcs: [{ id: "arc", title: "Arc", shuffleQuests: false, quests }],
})
const team = (name: string, questId = "quest") =>
	Team.parse({
		_id: name.toLowerCase(),
		name,
		passwordHash: "secret",
		seasonId: "season",
		questOrder: [questId],
		questIndex: 0,
		score: 0,
		completed: false,
		progress: [],
	})

describe("livePlaces", () => {
	it.each(["none", "warmer", "map"] as const)("includes a single place with %s guidance", (guidance) => {
		expect(livePlaces(season([quest("quest", guidance)]), [team("Alpha")])).toEqual([
			{ lat: place.lat, lng: place.lng, radius: place.radius, number: 1, teamIds: ["alpha"] },
		])
	})

	it("groups by quest and place, orders by first team then place number, and leaves inputs unchanged", () => {
		const source = season([quest("single"), quest("triple", "map", 3)])
		const teams = [team("Zulu", "triple"), team("Beta", "single"), team("Alpha", "triple")]
		const before = structuredClone({ source, teams })
		expect(livePlaces(source, teams)).toEqual([
			{ lat: place.lat, lng: place.lng, radius: 40, number: 1, teamIds: ["alpha", "zulu"] },
			{ lat: place.lat + 1, lng: place.lng, radius: 40, number: 2, teamIds: ["alpha", "zulu"] },
			{ lat: place.lat + 2, lng: place.lng, radius: 40, number: 3, teamIds: ["alpha", "zulu"] },
			{ lat: place.lat, lng: place.lng, radius: 40, number: 1, teamIds: ["beta"] },
		])
		expect({ source, teams }).toEqual(before)
	})

	it("uses only the current quest, not earlier or later quests", () => {
		const current = { ...team("Alpha"), questOrder: ["earlier", "quest", "later"], questIndex: 1 }
		expect(livePlaces(season([quest("earlier"), quest("quest"), quest("later")]), [current])).toEqual([
			{ lat: place.lat, lng: place.lng, radius: 40, number: 1, teamIds: ["alpha"] },
		])
	})

	it("skips non-location, completed, hidden, removed and unbuilt-order teams", () => {
		const source = season([quest("quest"), { ...quest("hidden"), hidden: true }, { ...newQuest(10), id: "plain" }])
		const teams = [
			team("Plain", "plain"),
			{ ...team("Completed"), completed: true },
			{ ...team("Finished"), questIndex: 1 },
			team("Hidden", "hidden"),
			team("Removed", "removed"),
			{ ...team("Unbuilt"), questOrder: [] },
		]
		expect(livePlaces(source, teams)).toEqual([])
	})
})

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
