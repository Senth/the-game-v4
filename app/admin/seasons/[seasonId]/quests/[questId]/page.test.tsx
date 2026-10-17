import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { HintsEditor } from "@/components/admin/hints-editor"
import { QuestEditor } from "@/components/admin/quest-editor"
import { QuestLiveStatsBlock } from "@/components/admin/quest-live-stats"
import { QuestPreview } from "@/components/admin/quest-preview"
import { QuestViewToggle } from "@/components/admin/quest-view-toggle"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason } from "@/lib/db/seasons"
import { listSeasonTeams } from "@/lib/db/teams"
import { hintRevealers } from "@/lib/domain/hints"
import { questLiveStats } from "@/lib/domain/quest-stats"
import { buildFixture } from "@/scripts/fixture"
import QuestPage from "./page"

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/db/seasons", () => ({ getSeason: vi.fn() }))
vi.mock("@/lib/db/teams", () => ({ listSeasonTeams: vi.fn() }))

const fixture = buildFixture(new Date("2026-10-12T17:00:00Z"))
const season = fixture.season
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
	vi.mocked(listSeasonTeams).mockResolvedValue(fixture.teams)
})

it("requires admin before reading quest data", async () => {
	vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("Unauthorized"))
	await expect(QuestPage(props)).rejects.toThrow("Unauthorized")
	expect(getSeason).not.toHaveBeenCalled()
	expect(listSeasonTeams).not.toHaveBeenCalled()
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
	const toggle = element.props.children[1]
	const content = toggle.props.children
	const titles = content.props.children[2]
	expect(getSeason).toHaveBeenCalledWith(season._id)
	expect(header.props).toEqual({ seasonId: season._id, arcTitle: arc.title, label: quest.internalTitle })
	expect(toggle.key).toBe(quest.id)
	expect(toggle.type).toBe(QuestViewToggle)
	expect(content.props.className).toBe("px-4 py-5 lg:px-8 lg:py-6")
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
		revealers: hintRevealers(fixture.teams, quest.id),
		start: season.start,
		end: season.end,
		now: titles.props.now,
	})
	expect(toggle.props.preview.type).toBe(QuestPreview)
	expect(toggle.props.preview.props).toEqual({
		season: {
			start: season.start,
			end: season.end,
			lengthMinutes: season.lengthMinutes,
			arcs: season.arcs,
		},
		arcId: arc.id,
		quest,
		now: titles.props.now,
	})
	expect(listSeasonTeams).toHaveBeenCalledExactlyOnceWith(season._id)
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
	const heading = element.props.children[1].props.children.props.children[0]
	expect(header.props.label).toBe(label)
	expect(heading.props.children).toBe(label ?? "Untitled quest")
	expect(heading.props.className).toContain("hidden truncate font-head text-2xl lg:block")
	expect(heading.props.className).toContain(label ? "text-head" : "text-muted")
})

it.each(["live", "upcoming", "ended"] as const)("shows desktop live stats only while %s", async (state) => {
	const now = Date.now()
	const liveSeason = {
		...season,
		start: new Date(state === "upcoming" ? now + 60_000 : now - 60_000),
		end: new Date(state === "ended" ? now - 1 : now + 60_000),
	}
	vi.mocked(getSeason).mockResolvedValue(liveSeason)
	const element = await QuestPage(props)
	const content = element.props.children[1].props.children
	const liveBlock = content.props.children[1]

	if (state === "live") {
		expect(liveBlock.props.className).toBe("hidden lg:block")
		expect(liveBlock.props.children.type).toBe(QuestLiveStatsBlock)
		expect(liveBlock.props.children.props.stats).toEqual(questLiveStats(liveSeason, fixture.teams)[quest.id])
		const html = renderToStaticMarkup(liveBlock)
		expect(html).toContain(">Live<")
		const stats = questLiveStats(liveSeason, fixture.teams)[quest.id]
		if (!stats) throw new Error("Fixture quest needs live stats")
		expect(html).toContain(`${stats.done}/${stats.total} done`)
		expect(html).toContain("w-40")
		expect(html).toContain("mb-8 rounded-md py-4")
		expect(html).toContain("Completed by")
		expect(html).not.toContain("Edit quest")
	} else {
		expect(liveBlock).toBeFalsy()
	}
	expect(listSeasonTeams).toHaveBeenCalledExactlyOnceWith(season._id)
})

it("loads a quest outside the first arc", async () => {
	const element = await QuestPage({
		...props,
		params: Promise.resolve({ seasonId: season._id, questId: "harbour-map" }),
	})
	expect(element.props.children[0].props.arcTitle).toBe("Old Town")
})

it.each(["unstarted", "live", "ended"])(
	"passes revealer names, never team documents, for removal during %s",
	async (state) => {
		vi.mocked(getSeason).mockResolvedValue({
			...season,
			start: state === "unstarted" ? null : new Date(Date.now() - 60_000),
			end: state === "ended" ? new Date(Date.now() - 1) : new Date(Date.now() + 60_000),
		})
		const element = await QuestPage(props)
		const hints = element.props.children[1].props.children.props.children[2].props.children
		expect(hints.props.revealers).toEqual(hintRevealers(fixture.teams, quest.id))
		expect(hints.props.start).toEqual(state === "unstarted" ? null : expect.any(Date))
		expect(hints.props.end).toEqual(expect.any(Date))
		expect(hints.props.now).toEqual(expect.any(Number))
		expect(hints.props).not.toHaveProperty("teams")
		expect(JSON.stringify(hints.props)).not.toContain("passwordHash")
		expect(listSeasonTeams).toHaveBeenCalledExactlyOnceWith(season._id)
	},
)

it("contains an accepted unbroken 100-character desktop heading without shortening the editable title", async () => {
	const displayTitle = "A".repeat(100)
	vi.mocked(getSeason).mockResolvedValue({
		...season,
		arcs: [{ ...arc, quests: [{ ...quest, internalTitle: "", displayTitle }] }],
	})
	const element = await QuestPage(props)
	const content = element.props.children[1].props.children
	const heading = content.props.children[0]
	expect(heading.props.children).toBe(displayTitle)
	expect(heading.props.className.split(" ")).toContain("truncate")
	expect(content.props.children[2].props.quest.displayTitle).toBe(displayTitle)
})

it("includes Ninjas in Backwards log's first hint revealers from the dev fixture", async () => {
	const element = await QuestPage(props)
	const editor = element.props.children[1].props.children.props.children[2].props.children
	const firstHint = quest.hints[0]
	if (!firstHint) throw new Error("Fixture needs a hint")
	expect(editor.props.start).toEqual(season.start)
	expect(editor.props.revealers[firstHint.id]).toContain("Ninjas")
})

it("passes future season timing to derive revealer visibility on the client", async () => {
	const start = new Date(Date.now() + 60_000)
	vi.mocked(getSeason).mockResolvedValue({ ...season, start })
	const element = await QuestPage(props)
	const hints = element.props.children[1].props.children.props.children[2].props.children
	expect(hints.props.start).toBe(start)
	expect(hints.props.now).toBeLessThan(start.getTime())
	expect(hints.props).not.toHaveProperty("hasStarted")
})
