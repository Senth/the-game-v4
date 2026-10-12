import { sealData } from "iron-session"
import { useSelectedLayoutSegment } from "next/navigation"
import { NextRequest } from "next/server"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { requireAdmin } from "@/lib/auth/guards"
import { sessionOptions } from "@/lib/auth/session"
import { getSeason, listSeasons } from "@/lib/db/seasons"
import { countTeams } from "@/lib/db/teams"
import { proxy } from "@/proxy"
import { buildFixture } from "@/scripts/fixture"
import SeasonLayout from "./layout"
import SeasonPage from "./page"
import SettingsPage from "./settings/page"
import TeamsPage from "./teams/page"

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/db/seasons", () => ({ getSeason: vi.fn(), listSeasons: vi.fn() }))
vi.mock("@/lib/db/teams", () => ({ countTeams: vi.fn() }))
vi.mock("@/app/admin/actions", () => ({ createSeasonAction: vi.fn() }))
vi.mock("next/navigation", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/navigation")>()),
	useSelectedLayoutSegment: vi.fn(),
	useRouter: () => ({ refresh: vi.fn() }),
}))

const fixture = buildFixture(new Date("2026-10-11T17:00:00Z"))
const season = { ...fixture.season, start: null, end: null }
const other = { ...season, _id: "other", title: "Other hunt" }
const settingsProps = { params: Promise.resolve({ seasonId: season._id }), searchParams: Promise.resolve({}) }

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(requireAdmin).mockReset().mockResolvedValue({ _id: "admin", name: "admin", passwordHash: "hash" })
	vi.mocked(getSeason).mockResolvedValue(season)
	vi.mocked(listSeasons).mockResolvedValue([other, season])
	vi.mocked(countTeams).mockResolvedValue(10)
	vi.mocked(useSelectedLayoutSegment).mockReturnValue(null)
})

it.each([
	["SeasonPage", SeasonPage],
	["TeamsPage", TeamsPage],
	["SettingsPage", SettingsPage],
] as const)("rejects %s when its page guard denies access", async (_name, Page) => {
	vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("Unauthorized"))
	await expect(Promise.resolve().then(() => Page(settingsProps))).rejects.toThrow("Unauthorized")
	expect(requireAdmin).toHaveBeenCalledOnce()
	expect(getSeason).not.toHaveBeenCalled()
})

it("requires admin access before reading season or team data", async () => {
	vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("Unauthorized"))
	await expect(
		SeasonLayout({ children: <SeasonPage />, params: Promise.resolve({ seasonId: season._id }) }),
	).rejects.toThrow("Unauthorized")
	expect(getSeason).not.toHaveBeenCalled()
	expect(listSeasons).not.toHaveBeenCalled()
	expect(countTeams).not.toHaveBeenCalled()
})

it("returns the Next.js 404 interrupt for an unknown season", async () => {
	vi.mocked(getSeason).mockResolvedValue(null)
	await expect(
		SeasonLayout({ children: <SeasonPage />, params: Promise.resolve({ seasonId: "unknown" }) }),
	).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" })
	expect(getSeason).toHaveBeenCalledWith("unknown")
	expect(listSeasons).not.toHaveBeenCalled()
	expect(countTeams).not.toHaveBeenCalled()
})

it("renders both frames with this season expanded, real team count, quiet preview and empty quests", async () => {
	const html = renderToStaticMarkup(
		await SeasonLayout({ children: await SeasonPage(), params: Promise.resolve({ seasonId: season._id }) }),
	)
	expect(getSeason).toHaveBeenCalledWith(season._id)
	expect(countTeams).toHaveBeenCalledWith(season._id)
	expect(html).toContain(season.title)
	expect(html).toContain("▾")
	expect(html).toContain("▸")
	expect(html).toContain("ml-3 border-l border-z1")
	expect(html).toContain("Season settings")
	expect(html).toContain("<span>10</span>")
	expect(html).toContain(`href="/admin/seasons/${other._id}"`)
	expect(html).toContain('href="/admin"')
	expect(html).toContain("‹ Seasons")
	expect(html).not.toContain("Seasons /")
	expect(html.split("Not started")).toHaveLength(5)
	expect(html).toContain("Pick a quest in the tree.")
	expect(html).toContain("Player preview")
	expect(html).toContain("Open a quest or team to preview it.")
	expect(html).toContain('action="/logout" method="post"')
	expect(html).not.toMatch(/<iframe|<input|Backwards log/)
	expect(html).not.toContain("Saved")
	expect(html).not.toContain("border-warn")
	expect(html).toContain("border-b px-1 font-cond border-z1")
	expect(html).toContain("w-72")
	expect(html).toContain("w-92")
	expect(html).toContain("min-w-0 flex-1")
	expect(renderToStaticMarkup(await SeasonPage())).toContain("hidden h-full")
})

it.each([
	["teams", TeamsPage, "Teams"],
	["settings", SettingsPage, "Season settings"],
] as const)("renders %s inside the shared shell", async (segment, Page, heading) => {
	vi.mocked(useSelectedLayoutSegment).mockReturnValue(segment)
	const html = renderToStaticMarkup(
		await SeasonLayout({ children: await Page(settingsProps), params: Promise.resolve({ seasonId: season._id }) }),
	)
	expect(html).toMatch(new RegExp(`<h2[^>]*>${heading}</h2>`))
	if (segment === "settings") {
		expect(html).toContain('class="space-y-5 px-4 py-5 lg:px-8 lg:py-6"')
		expect(html).toContain(">Title</label>")
		expect(html).toContain(`value="${season.title}"`)
	} else expect(renderToStaticMarkup(await TeamsPage())).toMatch(/^<h2[^>]*>Teams<\/h2>$/)
	const activeLinks = html.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? []
	expect(activeLinks.some((link) => link.includes(`href="/admin/seasons/${season._id}/${segment}"`))).toBe(true)
	expect(html).toContain("Player preview")
	expect(html).not.toContain("Pick a quest in the tree.")
})

it("returns the Next.js 404 interrupt when Settings loads an unknown season", async () => {
	vi.mocked(getSeason).mockResolvedValue(null)
	await expect(SettingsPage(settingsProps)).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" })
})

it.each(["", "/teams", "/settings"])(
	"redirects a real sealed team session away from the season%s URL",
	async (suffix) => {
		const options = sessionOptions()
		const seal = await sealData({ kind: "team", id: "t1" }, { password: options.password, ttl: options.ttl })
		const request = new NextRequest(`http://localhost/admin/seasons/${season._id}${suffix}`, {
			headers: { cookie: `${options.cookieName}=${seal}` },
		})
		const response = await proxy(request)
		expect(response.status).toBe(307)
		expect(response.headers.get("location")).toBe("http://localhost/")
	},
)
