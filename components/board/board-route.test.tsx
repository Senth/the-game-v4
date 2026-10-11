import { connection } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getBoard } from "@/app/board/actions"
import Board from "@/app/board/page"
import { requireAdmin, requireTeam } from "@/lib/auth/guards"
import { publicBoard } from "@/lib/domain/player-game"
import { loadBoard } from "@/lib/game/game"
import { buildFixture } from "@/scripts/fixture"
import { BoardScreen } from "./board-screen"

vi.mock("next/server", () => ({ connection: vi.fn() }))
vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn(), requireTeam: vi.fn() }))
vi.mock("@/lib/game/game", () => ({ loadBoard: vi.fn() }))

const now = new Date("2026-10-11T18:00:00Z")
const fixture = buildFixture(now)
const teams = fixture.teams.map((team) => ({ ...team, passwordHash: "x" }))
const board = publicBoard([fixture.season], { [fixture.season._id]: teams }, now)

afterEach(() => {
	vi.clearAllMocks()
	vi.useRealTimers()
})

describe("board route and action", () => {
	it("waits for a request before loading public data and passes only board channel", async () => {
		vi.useFakeTimers()
		vi.setSystemTime(now)
		vi.mocked(loadBoard).mockResolvedValue(board)
		const page = await Board()
		expect(connection).toHaveBeenCalledOnce()
		expect(vi.mocked(connection).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(loadBoard).mock.invocationCallOrder[0] as number,
		)
		expect(page.type).toBe(BoardScreen)
		expect(page.props).toEqual({ initial: board, initialNow: now.getTime(), channels: ["board"] })
		expect(requireTeam).not.toHaveBeenCalled()
		expect(requireAdmin).not.toHaveBeenCalled()
	})

	it("allows anonymous live reads without calling either guard", async () => {
		vi.mocked(loadBoard).mockResolvedValue(board)
		expect(await getBoard()).toBe(board)
		expect(loadBoard).toHaveBeenCalledExactlyOnceWith()
		expect(requireTeam).not.toHaveBeenCalled()
		expect(requireAdmin).not.toHaveBeenCalled()
	})
})
