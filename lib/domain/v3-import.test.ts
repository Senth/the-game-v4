import { describe, expect, it } from "vitest"
import fixture from "../../test/fixtures/v3-export.json"
import { Season } from "./schemas"
import { parseV3Export } from "./v3-import"

function source(quest = {}, season = {}) {
	return {
		custom_seasons: {
			"source-id": {
				title: "Source season",
				order: "Ordered",
				themes: [{ title: "Source arc", random: false, quests: [{ title: "Source quest", points: 5, ...quest }] }],
				...season,
			},
		},
	}
}

function mapped(quest = {}, season = {}) {
	const result = parseV3Export(source(quest, season))[0]
	if (!result) throw new Error("Missing mapped season")
	const mappedQuest = result.season.arcs[0]?.quests[0]
	if (!mappedQuest) throw new Error("Missing mapped quest")
	return { ...result, quest: mappedQuest }
}

describe("parseV3Export", () => {
	it("maps realistic seasons, preserves timing and validates every output", () => {
		const result = parseV3Export(fixture)
		expect(result).toHaveLength(2)
		const [first, second] = result
		expect(first?.season).toMatchObject({
			_id: "cipher-2023",
			title: "Cipher Night 2023",
			lengthMinutes: 90,
			start: new Date("2023-10-20T18:00:00Z"),
			end: new Date(1697829300 * 1000),
			registrationOpen: false,
			shuffleArcs: true,
			arcs: [
				{ title: "Lighthouse", shuffleQuests: true, quests: [expect.any(Object)] },
				{ title: "Old Town", shuffleQuests: false, quests: expect.any(Array) },
			],
		})
		expect(first?.season.arcs[0]?.quests[0]).toMatchObject({
			internalTitle: "Keeper's script",
			adminNotes: "Accept either language",
			displayTitle: "Read the log",
			answers: ["lighthouse", "fyren", "é"],
			points: 20,
			assetPath: null,
			hints: [
				{ id: expect.any(String), text: "Look at the light", points: 0 },
				{ id: expect.any(String), text: "It guides ships", points: 10000 },
			],
		})
		expect(second?.season).toMatchObject({
			_id: "cipher-2024",
			lengthMinutes: 60,
			start: new Date(1729447200 * 1000),
			end: new Date(1729447200 * 1000 + 60 * 60_000),
			registrationOpen: false,
			shuffleArcs: false,
		})
		for (const { season } of result) expect(Season.parse(season)).toEqual(season)
		expect(first?.warnings).toHaveLength(6)
		expect(second?.warnings).toHaveLength(3)
	})

	it("gives copied arcs, quests and hints fresh UUIDs and leaves inputs unchanged", () => {
		const before = structuredClone(fixture)
		const result = parseV3Export(fixture)
		const ids = result.flatMap(({ season }) =>
			season.arcs.flatMap((arc) => [
				arc.id,
				...arc.quests.flatMap((quest) => [quest.id, ...quest.hints.map((hint) => hint.id)]),
			]),
		)
		expect(new Set(ids).size).toBe(ids.length)
		for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
		expect(ids).not.toContain("shared-quest-id")
		const quest = result[0]?.season.arcs[0]?.quests[0]
		quest?.answers.push("new answer")
		expect(fixture).toEqual(before)
	})

	it.each([
		["Ordered", false],
		["Random All", true],
		["Random Theme", true],
		["Random Quest", false],
	])("maps %s without changing theme shuffle flags", (order, shuffleArcs) => {
		expect(mapped({}, { order }).season.shuffleArcs).toBe(shuffleArcs)
		expect(mapped({}, { order }).season.arcs[0]?.shuffleQuests).toBe(false)
	})

	it("uses draft defaults for missing optional fields and does not force registration open", () => {
		const { season, quest, assetJobs, warnings } = mapped({}, { registrationOpen: true })
		expect(season).toMatchObject({ start: null, end: null, lengthMinutes: 60, registrationOpen: false })
		expect(quest).toEqual({
			id: expect.any(String),
			internalTitle: "Source quest",
			displayTitle: "",
			adminNotes: "",
			content: "",
			answers: [],
			assetPath: null,
			points: 5,
			hints: [],
		})
		expect(assetJobs).toEqual({})
		expect(warnings).toEqual([])
	})

	it.each([
		"2024-01-01T00:00:00Z",
		"2024-01-01T01:00:00+01:00",
		{ _seconds: 1704067200 },
		{ seconds: 1704067200 },
		{ __datatype__: "timestamp", value: { _seconds: 1704067200 } },
	])("accepts timestamp %j and derives missing end from length", (start) => {
		expect(mapped({}, { start, length: 30 }).season).toMatchObject({
			start: new Date("2024-01-01T00:00:00Z"),
			end: new Date("2024-01-01T00:30:00Z"),
		})
	})

	it("keeps explicit end even without start", () => {
		expect(mapped({}, { end: { _seconds: 1704067200 } }).season).toMatchObject({
			start: null,
			end: new Date("2024-01-01T00:00:00Z"),
		})
	})

	it("splits, trims, NFC-normalizes and deduplicates answers, dropping only overlong ones", () => {
		const { quest, warnings } = mapped({ answer: ` é | É | | test | TEST | ${"x".repeat(200)} | ${"x".repeat(201)}` })
		expect(quest.answers).toEqual(["é", "test", "x".repeat(200)])
		expect(warnings).toEqual([expect.stringContaining("200")])
		expect(fixture.game_seasons["cipher-2023"].themes[1]?.quests[2]?.answer).toHaveLength(201)
	})

	it.each([-1, 10001, 1.5, null, "5", undefined])(
		"turns invalid quest points %j into a draft with a named warning",
		(points) => {
			const { quest, warnings } = mapped({ points })
			expect(quest.points).toBeNull()
			expect(warnings).toEqual([expect.stringContaining("points")])
			expect(warnings[0]).toContain("Source season")
			expect(warnings[0]).toContain("source-id")
			expect(warnings[0]).toContain("Source arc")
			expect(warnings[0]).toContain("Source quest")
		},
	)

	it.each([0, 10000])("keeps valid point boundary %i without warnings", (points) => {
		expect(mapped({ points, hints: [{ text: "Hint", points }] })).toMatchObject({
			quest: { points, hints: [{ points }] },
			warnings: [],
		})
	})

	it("drops empty hints, keeps remaining text and clamps out-of-range penalties with named warnings", () => {
		const { quest, warnings } = mapped({
			hints: [
				{ text: "" },
				{},
				{ text: "\n\t " },
				{ text: " Low ", points: -1 },
				{ text: "High", points: 10001 },
				{ text: "Normal", points: 5 },
			],
		})
		expect(quest.hints).toEqual([
			{ id: expect.any(String), text: " Low ", points: 0 },
			{ id: expect.any(String), text: "High", points: 10000 },
			{ id: expect.any(String), text: "Normal", points: 5 },
		])
		expect(warnings).toHaveLength(2)
		for (const warning of warnings) expect(warning).toMatch(/Source season.*Source arc.*Source quest.*hint.*points/)
	})

	it.each(["plain", "`", "```", "before ````` after"])("fences code safely for content %s", (content) => {
		const { quest } = mapped({ code: "javascript", content })
		const fence = "`".repeat(Math.max(3, ...[...content.matchAll(/`+/g)].map(([run]) => run.length + 1)))
		expect(quest.content).toBe(`${fence}javascript\n${content}\n${fence}`)
	})

	it("keeps trusted HTML raw and does not add a fence for missing content", () => {
		const content = "<div><strong>Raw HTML</strong></div>"
		expect(mapped({ content }).quest.content).toBe(content)
		expect(mapped({ code: "python" }).quest.content).toBe("")
	})

	it.each([
		[{ asset: "https://example.com/file.pdf" }, [{ url: "https://example.com/file.pdf", target: "assetPath" }]],
		[{ imageUrl: "https://example.com/image.png" }, [{ url: "https://example.com/image.png", target: "assetPath" }]],
		[
			{ asset: "", imageUrl: "https://example.com/image.png" },
			[{ url: "https://example.com/image.png", target: "assetPath" }],
		],
		[
			{ asset: "https://example.com/file.pdf", imageUrl: "https://example.com/image.png" },
			[
				{ url: "https://example.com/file.pdf", target: "assetPath" },
				{ url: "https://example.com/image.png", target: "content" },
			],
		],
	])("queues asset jobs by new quest id for %j without fetching or appending remote URLs", (fields, jobs) => {
		const { quest, assetJobs, warnings } = mapped(fields)
		expect(quest.assetPath).toBeNull()
		expect(quest.content).toBe("")
		expect(assetJobs).toEqual({ [quest.id]: jobs })
		expect(warnings).toHaveLength(jobs.length === 2 ? 1 : 0)
		if (jobs.length === 2) expect(warnings[0]).toMatch(/Source season.*Source arc.*Source quest.*Markdown image/)
	})

	it.each([{}, { one: {}, two: {} }, { __collections__: {} }])(
		"rejects export without exactly one collection: %j",
		(input) => {
			expect(() => parseV3Export(input)).toThrow("V3 export must contain exactly one collection")
		},
	)

	it("ignores __collections__ metadata and accepts an empty season collection", () => {
		expect(parseV3Export({ arbitrary_prefix_seasons: { __collections__: {} }, __collections__: {} })).toEqual([])
	})

	it.each([
		{ length: 0 },
		{ length: 1441 },
		{ length: 1.5 },
		{ start: "not a date" },
		{ start: { seconds: "invalid" } },
		{ start: { __datatype__: "other", value: { _seconds: 1 } } },
		{ start: { _seconds: 1e20 } },
		{ order: "unknown" },
		{ themes: "invalid" },
	])("rejects invalid source or mapped season: %j", (season) => {
		expect(() => parseV3Export(source({}, season))).toThrow()
	})

	it("validates hints against the v4 whole-number rule", () => {
		expect(() => mapped({ hints: [{ text: "Hint", points: 1.5 }] })).toThrow()
	})
})
