import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { requireAdmin } from "@/lib/auth/guards"
import { listSeasons } from "@/lib/db/seasons"
import { buildFixture } from "@/scripts/fixture"
import AdminPage from "./page"

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/db/seasons", () => ({ listSeasons: vi.fn() }))
vi.mock("@/app/admin/actions", () => ({ createSeasonAction: vi.fn() }))

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(listSeasons).mockResolvedValue([])
})

it("checks access before loading seasons", async () => {
	vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("Unauthorized"))
	await expect(AdminPage()).rejects.toThrow("Unauthorized")
	expect(listSeasons).not.toHaveBeenCalled()
})

it("composes both responsive lists with no expanded season and no old Admin placeholder", async () => {
	vi.mocked(listSeasons).mockResolvedValue([buildFixture(new Date()).season])
	const html = renderToStaticMarkup(await AdminPage())
	expect(html).toContain("Seasons</h1>")
	expect(html).not.toContain("Admin</h1>")
	expect(html).toContain("+ New season")
	expect(html).toContain("Pick a season, or create one.")
	expect(html).toContain('class="lg:hidden"')
	expect(html).not.toContain('aria-current="page"')
})

it("shows No seasons yet on both frames while keeping creation available", async () => {
	const html = renderToStaticMarkup(await AdminPage())
	expect(html.split("No seasons yet.")).toHaveLength(4)
	expect(html).toContain("New season")
	expect(html).not.toContain("Pick a season, or create one.")
})
