import jsQR from "jsqr"
import { headers } from "next/headers"
import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { verifyJoinToken } from "@/lib/auth/join"
import { getTeam } from "@/lib/db/teams"
import { buildFixture } from "@/scripts/fixture"
import { TeamQr } from "./team-qr"
import { storedQrShown, TeamQrControls } from "./team-qr-controls"

const hooks = vi.hoisted(() => ({
	states: [] as boolean[],
	cursor: 0,
	effects: [] as EffectCallback[],
	timer: { current: null as ReturnType<typeof setTimeout> | null },
}))

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: boolean) => {
		const index = hooks.cursor++
		hooks.states[index] ??= initial
		return [
			hooks.states[index],
			(value: boolean) => {
				hooks.states[index] = value
			},
		]
	},
	useRef: () => hooks.timer,
	useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
}))
vi.mock("next/headers", () => ({ headers: vi.fn() }))
vi.mock("@/lib/db/teams", () => ({ getTeam: vi.fn() }))

const fixture = buildFixture(new Date("2026-10-10T18:00:00Z"))
const team = { ...(fixture.teams[0] as (typeof fixture.teams)[number]), passwordHash: "secret-password-hash" }
const url = "https://game.example/join/token"
const storage = { getItem: vi.fn(), setItem: vi.fn() }
const writeText = vi.fn()

function controls() {
	hooks.cursor = 0
	hooks.effects.length = 0
	const element = TeamQrControls({ url, svg: "<svg/>" })
	return {
		html: renderToStaticMarkup(element),
		copy: element.props.children[0]?.props?.children[2].props.onClick as () => Promise<void>,
		toggle: element.props.children[1].props.onClick as () => void,
	}
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.resetAllMocks()
	hooks.states.length = 0
	hooks.cursor = 0
	hooks.effects.length = 0
	hooks.timer.current = null
	vi.stubGlobal("localStorage", storage)
	vi.stubGlobal("navigator", { clipboard: { writeText } })
	storage.getItem.mockReturnValue(null)
	writeText.mockResolvedValue(undefined)
	vi.mocked(getTeam).mockResolvedValue(team)
})

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

describe("TeamQr", () => {
	it.each(["http", "https"])("renders an SVG that decodes to a valid %s join URL", async (protocol) => {
		vi.mocked(headers).mockResolvedValue(new Headers({ host: "game.example:3000", "x-forwarded-proto": protocol }))
		const element = await TeamQr({ team })
		expect(element.type).toBe(TeamQrControls)
		expect(Object.keys(element.props)).toEqual(["url", "svg"])
		const html = renderToStaticMarkup(element)
		const svg = decodeURIComponent(/src="data:image\/svg\+xml,([^"]+)"/.exec(html)?.[1] ?? "")
		expect(svg).toContain('width="224"')
		expect(svg).toContain('height="224"')
		expect(svg).toContain('fill="#c5c7d8"')
		expect(svg).toContain('stroke="#05080d"')
		expect(html).toContain("size-56 overflow-hidden rounded-md")
		expect(html).not.toContain(team.passwordHash)

		const width = Number(/viewBox="0 0 (\d+) /.exec(svg)?.[1]) * 4
		const pixels = new Uint8ClampedArray(width * width * 4)
		for (let pixel = 0; pixel < pixels.length; pixel += 4) pixels.set([197, 199, 216, 255], pixel)
		const path = /stroke="#05080d" d="([^"]+)"/.exec(svg)?.[1] ?? ""
		let x = 0
		let y = 0
		for (const command of path.matchAll(/(M|m|h)([\d.]+)(?: ([\d.]+))?/g)) {
			const length = Number(command[2]) * 4
			if (command[1] === "M") {
				x = length
				y = Math.floor(Number(command[3])) * 4
			} else if (command[1] === "m") x += length
			else {
				for (let row = y; row < y + 4; row++)
					for (let col = x; col < x + length; col++) pixels.set([5, 8, 13, 255], (row * width + col) * 4)
				x += length
			}
		}
		const decoded = jsQR(pixels, width, width)?.data
		expect(decoded).toBe(element.props.url)
		const join = new URL(decoded ?? "")
		expect(join.origin).toBe(`${protocol}://game.example:3000`)
		expect(join.pathname).toMatch(/^\/join\//)
		expect(await verifyJoinToken(decodeURIComponent(join.pathname.slice("/join/".length)))).toEqual(team)
	})

	it("uses http when the forwarded protocol is absent", async () => {
		vi.mocked(headers).mockResolvedValue(new Headers({ host: "localhost:3000" }))
		expect((await TeamQr({ team })).props.url).toMatch(/^http:\/\/localhost:3000\/join\//)
	})
})

describe("storedQrShown", () => {
	it.each([
		[null, true],
		["hidden", false],
		["shown", true],
	])("reads %s as shown=%s", (stored, shown) => {
		storage.getItem.mockReturnValue(stored)
		expect(storedQrShown()).toBe(shown)
	})

	it("defaults to shown when storage throws", () => {
		storage.getItem.mockImplementation(() => {
			throw new Error("Storage unavailable")
		})
		expect(storedQrShown()).toBe(true)
	})
})

describe("TeamQrControls", () => {
	it("shows the QR before reading storage, then restores hidden and persists show/hide", () => {
		storage.getItem.mockReturnValue("hidden")
		const initial = controls()
		expect(initial.html).toContain("QR code to log in to your team")
		expect(initial.html.indexOf("<img")).toBeLessThan(initial.html.indexOf("Copy link"))
		expect(initial.html).toContain("Teammates scan this to log in.")
		expect(storage.getItem).not.toHaveBeenCalled()
		for (const effect of hooks.effects) effect()
		const hidden = controls()
		expect(hidden.html).toContain("Show QR code")
		expect(hidden.html).not.toContain("<img")
		expect(hidden.html).not.toContain("Copy link")
		hidden.toggle()
		expect(storage.setItem).toHaveBeenLastCalledWith("the-game-qr", "shown")
		const shown = controls()
		expect(shown.html).toContain("Hide QR code")
		shown.toggle()
		expect(storage.setItem).toHaveBeenLastCalledWith("the-game-qr", "hidden")
	})

	it("still toggles when storage cannot save", () => {
		storage.setItem.mockImplementation(() => {
			throw new Error("Storage unavailable")
		})
		controls().toggle()
		expect(controls().html).toContain("Show QR code")
	})

	it("copies the exact URL and shows Copied for two seconds, restarting on another copy", async () => {
		await controls().copy()
		expect(writeText).toHaveBeenCalledWith(url)
		expect(controls().html).toContain("Copied")
		await vi.advanceTimersByTimeAsync(1000)
		await controls().copy()
		await vi.advanceTimersByTimeAsync(1999)
		expect(controls().html).toContain("Copied")
		await vi.advanceTimersByTimeAsync(1)
		expect(controls().html).toContain("Copy link")
	})

	it("reports clipboard failure without claiming success", async () => {
		writeText.mockRejectedValue(new Error("Clipboard denied"))
		await controls().copy()
		const html = controls().html
		expect(html).toContain("Could not copy. Try again.")
		expect(html).not.toContain("Copied")
	})

	it("clears the copied timer when unmounted", async () => {
		controls()
		const cleanup = hooks.effects[0]?.()
		await controls().copy()
		expect(vi.getTimerCount()).toBe(1)
		if (cleanup) cleanup()
		expect(vi.getTimerCount()).toBe(0)
	})
})
