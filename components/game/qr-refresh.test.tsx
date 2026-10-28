import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { getGame } from "@/app/actions"
import { resetTeamPasswordAction } from "@/app/admin/team-actions"
import Home from "@/app/page"
import { TeamQr } from "@/components/team-qr"
import { TeamQrControls } from "@/components/team-qr-controls"
import { requireTeam } from "@/lib/auth/guards"
import { verifyJoinToken } from "@/lib/auth/join"
import { collections } from "@/lib/db/collections"
import { createTeam, getTeam } from "@/lib/db/teams"
import type { PlayerGame } from "@/lib/domain/player-game"
import { subscribe } from "@/lib/events/bus"
import { useTestDb as setupTestDb } from "@/test/db"

const hooks = vi.hoisted(() => ({ effects: [] as EffectCallback[], refresh: vi.fn() }))
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
	useEffectEvent: (callback: unknown) => callback,
}))
vi.mock("next/navigation", async (original) => ({
	...(await original<typeof import("next/navigation")>()),
	useRouter: () => ({ refresh: hooks.refresh }),
}))
vi.mock("next/headers", () => ({
	headers: async () => new Headers({ host: "game.example", "x-forwarded-proto": "https" }),
}))
vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn(), requireTeam: vi.fn() }))
vi.mock("@/app/actions", () => ({ getGame: vi.fn(), submitAnswer: vi.fn(), revealHint: vi.fn() }))

setupTestDb()
beforeEach(async () => {
	await (await collections()).teams.deleteMany({})
})
afterEach(() => {
	hooks.effects.length = 0
	vi.clearAllMocks()
	vi.unstubAllGlobals()
})

it.each(["waiting", "countdown"] as const)(
	"replaces the displayed and copied %s QR with a working join link after password reset",
	async (lifecycleState) => {
		const team = await createTeam({
			name: "Ninjas",
			seasonId: "season",
			passwordHash: "old-password-hash",
			questOrder: [],
			questIndex: 0,
			score: 0,
			completed: false,
			progress: [],
		})
		vi.mocked(requireTeam).mockImplementation(async () => {
			const current = await getTeam(team._id)
			if (!current) throw new Error("Missing team")
			return current
		})
		const game: PlayerGame =
			lifecycleState === "waiting"
				? { lifecycleState, teamName: team.name, phones: [] }
				: { lifecycleState, start: new Date(Date.now() + 60_000), teamName: team.name, phones: [] }
		vi.mocked(getGame).mockResolvedValue(game)
		let page = await Home()
		let qr = await TeamQr(page.props.qr.props)
		const oldUrl = qr.props.url
		const oldSvg = qr.props.svg
		const token = (url: string) => decodeURIComponent(new URL(url).pathname.slice("/join/".length))
		expect(await verifyJoinToken(token(oldUrl))).toEqual(team)
		hooks.refresh.mockImplementation(async () => {
			page = await Home()
			qr = await TeamQr(page.props.qr.props)
		})
		const source = {
			readyState: 1,
			onopen: null,
			onmessage: null as (() => void) | null,
			onerror: null,
			close: vi.fn(),
		}
		vi.stubGlobal(
			"EventSource",
			vi.fn(function EventSourceMock() {
				return source
			}),
		)
		vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }))
		const unsubscribe = subscribe([`team:${team._id}`], () => source.onmessage?.())
		renderToStaticMarkup({ ...page, props: { ...page.props, qr } })
		const cleanups = hooks.effects.map((effect) => effect()).filter((cleanup): cleanup is () => void => !!cleanup)
		try {
			const data = new FormData()
			data.set("password", "new-password")
			expect(await resetTeamPasswordAction("season", team._id, {}, data)).toEqual({ ok: true })
			expect(await verifyJoinToken(token(oldUrl))).toBeNull()
			await vi.waitFor(() => expect(qr.props.url).not.toBe(oldUrl))
			expect(hooks.refresh).toHaveBeenCalledOnce()
			expect(qr.props.svg).not.toBe(oldSvg)
			const updated = await getTeam(team._id)
			expect(await verifyJoinToken(token(qr.props.url))).toEqual(updated)
			const html = renderToStaticMarkup({ ...page, props: { ...page.props, qr } })
			expect(html).toContain(encodeURIComponent(qr.props.svg))
			expect(JSON.stringify(qr.props)).not.toContain("passwordHash")
			expect(JSON.stringify(qr.props)).not.toContain(updated?.passwordHash)
			const writeText = vi.fn().mockResolvedValue(undefined)
			vi.stubGlobal("navigator", { clipboard: { writeText } })
			let copy!: () => Promise<void>
			function Controls() {
				const element = TeamQrControls(qr.props)
				copy = element.props.children[0].props.children[2].props.onClick
				return element
			}
			renderToStaticMarkup(<Controls />)
			const cleanupControls = hooks.effects.at(-1)?.()
			await copy()
			expect(writeText).toHaveBeenCalledWith(qr.props.url)
			cleanupControls?.()
		} finally {
			unsubscribe()
			for (const cleanup of cleanups) cleanup()
		}
	},
)
