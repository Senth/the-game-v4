import { beforeEach, expect, it, vi } from "vitest"
import { HintsEditor } from "@/components/admin/hints-editor"
import { QuestEditor } from "@/components/admin/quest-editor"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason } from "@/lib/db/seasons"
import { buildFixture } from "@/scripts/fixture"
import QuestPage from "./page"

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/db/seasons", () => ({ getSeason: vi.fn() }))

const season = buildFixture(new Date("2026-10-12T17:00:00Z")).season
const arc = season.arcs[0]
if (!arc) throw new Error("Fixture needs an arc")
const quest = arc.quests[0]
if (!quest) throw new Error("Fixture needs a quest")
const props = {
	params: Promise.resolve({ seasonId: season._id, questId: quest.id }),
	searchParams: Promise.resolve({}),
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(requireAdmin).mockResolvedValue({ _id: "admin", name: "admin", passwordHash: "hash" })
	vi.mocked(getSeason).mockResolvedValue(season)
})

it("requires admin before reading quest data", async () => {
	vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("Unauthorized"))
	await expect(QuestPage(props)).rejects.toThrow("Unauthorized")
	expect(getSeason).not.toHaveBeenCalled()
})

it.each(["season", "arc", "quest"])("redirects to the Quests tab when %s disappears", async (missing) => {
	vi.mocked(getSeason).mockResolvedValue(
		missing === "season" ? null : { ...season, arcs: missing === "arc" ? [] : [{ ...arc, quests: [] }] },
	)
	await expect(QuestPage(props)).rejects.toMatchObject({
		digest: `NEXT_REDIRECT;replace;/admin/seasons/${season._id};307;`,
	})
})

it("selects the quest's own arc and passes editor fields without hints across the client boundary", async () => {
	const before = Date.now()
	const element = await QuestPage(props)
	const header = element.props.children[0]
	const content = element.props.children[1]
	const titles = content.props.children[1]
	expect(getSeason).toHaveBeenCalledWith(season._id)
	expect(header.props).toEqual({ seasonId: season._id, arcTitle: arc.title, label: quest.internalTitle })
	expect(content.props.className).toBe("px-4 py-5 lg:px-8 lg:py-6")
	expect(titles.key).toBe(quest.id)
	expect(titles.type).toBe(QuestEditor)
	expect(titles.props.quest).toEqual({
		id: quest.id,
		displayTitle: quest.displayTitle,
		internalTitle: quest.internalTitle,
		content: quest.content,
		assetPath: quest.assetPath,
		answers: quest.answers,
		points: quest.points,
		adminNotes: quest.adminNotes,
	})
	expect(titles.props.arcId).toBe(arc.id)
	expect(titles.props.start).toBe(season.start)
	expect(titles.props.end).toBe(season.end)
	expect(titles.props.now).toBeGreaterThanOrEqual(before)
	expect(titles.props.now).toBeLessThanOrEqual(Date.now())
	expect(titles.props.quest).not.toHaveProperty("hints")
	expect(titles.props.children.type).toBe(HintsEditor)
	expect(titles.props.children.props).toEqual({
		arcId: arc.id,
		questId: quest.id,
		points: quest.points,
		hints: quest.hints,
	})
})

it.each([
	["Internal", "Display", "Internal"],
	[" ", "Display", "Display"],
	["", "", null],
])("uses matching header and desktop heading fallbacks for %s / %s", async (internalTitle, displayTitle, label) => {
	vi.mocked(getSeason).mockResolvedValue({
		...season,
		arcs: [{ ...arc, quests: [{ ...quest, internalTitle, displayTitle }] }],
	})
	const element = await QuestPage(props)
	const header = element.props.children[0]
	const heading = element.props.children[1].props.children[0]
	expect(header.props.label).toBe(label)
	expect(heading.props.children).toBe(label ?? "Untitled quest")
	expect(heading.props.className).toContain("hidden truncate font-head text-2xl lg:block")
	expect(heading.props.className).toContain(label ? "text-head" : "text-muted")
})

it("loads a quest outside the first arc", async () => {
	const element = await QuestPage({
		...props,
		params: Promise.resolve({ seasonId: season._id, questId: "harbour-map" }),
	})
	expect(element.props.children[0].props.arcTitle).toBe("Old Town")
})

it("contains an accepted unbroken 100-character desktop heading without shortening the editable title", async () => {
	const displayTitle = "A".repeat(100)
	vi.mocked(getSeason).mockResolvedValue({
		...season,
		arcs: [{ ...arc, quests: [{ ...quest, internalTitle: "", displayTitle }] }],
	})
	const element = await QuestPage(props)
	const content = element.props.children[1]
	const heading = content.props.children[0]
	expect(heading.props.children).toBe(displayTitle)
	expect(heading.props.className.split(" ")).toContain("truncate")
	expect(content.props.children[1].props.quest.displayTitle).toBe(displayTitle)
})
