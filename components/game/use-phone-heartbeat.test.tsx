import type { EffectCallback, ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { pingPhone } from "@/app/actions"
import { QuestPreview } from "@/components/admin/quest-preview"
import { TeamPreview } from "@/components/admin/team-preview"
import { buildFixture } from "@/scripts/fixture"
import { usePhoneHeartbeat } from "./use-phone-heartbeat"

const hooks = vi.hoisted(() => ({ effects: [] as EffectCallback[] }))
vi.mock("react", async (importOriginal) => {
	const react = await importOriginal<typeof import("react")>()
	return {
		...react,
		useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
	}
})
vi.mock("@/app/actions", () => ({ pingPhone: vi.fn() }))
vi.mock("@/app/admin/actions", () => ({ getPuzzlePreviewAssets: vi.fn() }))
vi.mock("@/components/admin/autosave-provider", () => ({
	useDraftValue: (_target: unknown, value: unknown) => value,
	useDraftHints: (_target: unknown, value: unknown) => value,
}))

const phones = [{ name: "Quiet Fox", you: true }]
const onPhones = vi.fn()
let cleanup: (() => void)[] = []

function Harness() {
	usePhoneHeartbeat(onPhones)
	return null
}

function mount(view: ReactElement = <Harness />) {
	hooks.effects.length = 0
	renderToStaticMarkup(view)
	cleanup = hooks.effects.map((effect) => effect()).filter((stop): stop is () => void => !!stop)
}

function visible(hidden: boolean) {
	Object.assign(document, { hidden })
	document.dispatchEvent(new Event("visibilitychange"))
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.clearAllMocks()
	cleanup = []
	vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }))
	vi.mocked(pingPhone).mockResolvedValue({ phones })
})

afterEach(() => {
	for (const stop of cleanup) stop()
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

it("pings every two minutes while visible and returns the refreshed list", async () => {
	mount()
	expect(pingPhone).not.toHaveBeenCalled()
	await vi.advanceTimersByTimeAsync(119_999)
	expect(pingPhone).not.toHaveBeenCalled()
	await vi.advanceTimersByTimeAsync(1)
	expect(pingPhone).toHaveBeenCalledOnce()
	expect(onPhones).toHaveBeenCalledWith(phones)
})

it("pauses while hidden and pings as soon as the page becomes visible", async () => {
	mount()
	visible(true)
	await vi.advanceTimersByTimeAsync(240_000)
	expect(pingPhone).not.toHaveBeenCalled()
	visible(false)
	await vi.advanceTimersByTimeAsync(0)
	expect(pingPhone).toHaveBeenCalledOnce()
	expect(onPhones).toHaveBeenCalledWith(phones)
	await vi.advanceTimersByTimeAsync(120_000)
	expect(pingPhone).toHaveBeenCalledTimes(2)
})

it("cleans up timers and ignores late responses after unmount", async () => {
	let finish!: (value: { phones: typeof phones }) => void
	vi.mocked(pingPhone).mockReturnValue(new Promise((resolve) => (finish = resolve)))
	mount()
	await vi.advanceTimersByTimeAsync(120_000)
	for (const stop of cleanup) stop()
	cleanup = []
	finish({ phones })
	await vi.advanceTimersByTimeAsync(0)
	await vi.advanceTimersByTimeAsync(240_000)
	expect(pingPhone).toHaveBeenCalledOnce()
	expect(onPhones).not.toHaveBeenCalled()
})

it("does not ping when initially hidden", async () => {
	Object.assign(document, { hidden: true })
	mount()
	await vi.advanceTimersByTimeAsync(240_000)
	expect(pingPhone).not.toHaveBeenCalled()
	visible(false)
	await vi.advanceTimersByTimeAsync(0)
	expect(pingPhone).toHaveBeenCalledOnce()
})

it.each(["waiting", "countdown", "running", "quest"] as const)(
	"never pings from the real %s preview with effects, timers and visibility changes",
	async (state) => {
		const now = Date.now()
		const { season, teams } = buildFixture(new Date(now))
		const team = teams.find((team) => team.name === "Ninjas")
		if (!team) throw new Error("Missing Ninjas fixture")
		const arc = season.arcs[0]
		const quest = arc?.quests[0]
		if (!arc || !quest) throw new Error("Missing quest fixture")
		mount(
			state === "quest" ? (
				<QuestPreview season={season} arcId={arc.id} quest={quest} now={now} />
			) : (
				<TeamPreview
					season={{
						...season,
						...(state === "waiting"
							? { start: null, end: null }
							: state === "countdown"
								? { start: new Date(now + 600_000) }
								: {}),
					}}
					team={team}
					teams={teams}
					now={now}
				/>
			),
		)
		await vi.advanceTimersByTimeAsync(240_000)
		visible(true)
		await vi.advanceTimersByTimeAsync(240_000)
		visible(false)
		await vi.advanceTimersByTimeAsync(240_000)
		expect(pingPhone).not.toHaveBeenCalled()
	},
)
