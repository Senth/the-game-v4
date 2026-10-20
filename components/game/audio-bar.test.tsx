import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { AudioBar } from "./audio-bar"

const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0, audio: { current: null as unknown } }))
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (initial: unknown) => {
		const index = hooks.cursor++
		if (!(index in hooks.states)) hooks.states[index] = initial
		return [
			hooks.states[index],
			(value: unknown) => {
				hooks.states[index] = value
			},
		]
	},
	useRef: () => hooks.audio,
}))

function view() {
	hooks.cursor = 0
	const element = AudioBar({ src: "/assets/clue.mp3" })
	const [audio, button, track] = element.props.children
	return { html: renderToStaticMarkup(element), audio, button, range: track.props.children[1] }
}

beforeEach(() => {
	hooks.states = []
	hooks.audio.current = null
})

it("renders mock F's quiet track, clock and 44 px accent play button with metadata-only audio", () => {
	const { html, audio, button, range } = view()
	expect(audio.props).toMatchObject({ src: "/assets/clue.mp3", preload: "metadata", hidden: true })
	expect(audio.props.controls).toBeUndefined()
	expect(html).toContain("rounded-md bg-field px-3 py-2")
	expect(button.props.className).toContain("h-11 w-11")
	expect(button.props.className).toContain("rounded-full bg-accent")
	expect(html).toContain("rounded-full bg-z2")
	expect(html).toContain("rounded-full bg-accent")
	expect(html).toContain("font-cond text-sm text-muted tabular-nums")
	expect(html).toContain("0:00 / 0:00")
	expect(range.props.disabled).toBe(true)
})

it("keeps native button Space/Enter activation and range arrow-key seeking without overriding keyboard defaults", async () => {
	const media = { paused: true, currentTime: 0, play: vi.fn().mockResolvedValue(undefined), pause: vi.fn() }
	hooks.audio.current = media
	const initial = view()
	expect(initial.button.type).toBe("button")
	expect(initial.button.props.type).toBe("button")
	expect(initial.button.props.onKeyDown).toBeUndefined()
	expect(initial.range.type).toBe("input")
	expect(initial.range.props).toMatchObject({ type: "range", min: 0, step: 1, "aria-label": "Seek audio" })
	expect(initial.range.props.onKeyDown).toBeUndefined()
	await initial.button.props.onClick()
	expect(media.play).toHaveBeenCalledOnce()
	initial.audio.props.onPlay()
	media.paused = false
	expect(view().button.props["aria-label"]).toBe("Pause audio")
	await view().button.props.onClick()
	expect(media.pause).toHaveBeenCalledOnce()
	view().audio.props.onPause()
	expect(view().button.props["aria-label"]).toBe("Play audio")

	view().audio.props.onLoadedMetadata({ currentTarget: { duration: 42 } })
	view().audio.props.onTimeUpdate({ currentTarget: { currentTime: 12 } })
	expect(view().range.props).toMatchObject({ max: 42, value: 12, disabled: false, "aria-valuetext": "0:12 / 0:42" })
	expect(view().html).toContain("0:12 / 0:42")
	view().range.props.onChange({ currentTarget: { value: "13" } })
	expect(media.currentTime).toBe(13)
	expect(view().range.props.value).toBe(13)
	view().range.props.onChange({ currentTarget: { value: "12" } })
	expect(media.currentTime).toBe(12)
	expect(view().html).toContain('style="width:28.57142857142857%"')
})

it("returns to Play audio on ending and permits retry after rejected playback", async () => {
	const media = { paused: true, play: vi.fn().mockRejectedValueOnce(new Error("NotSupportedError")) }
	hooks.audio.current = media
	await view().button.props.onClick()
	expect(view().button.props["aria-label"]).toBe("Play audio")
	media.play.mockResolvedValueOnce(undefined)
	await view().button.props.onClick()
	view().audio.props.onPlay()
	expect(view().button.props["aria-label"]).toBe("Pause audio")
	view().audio.props.onEnded()
	expect(view().button.props["aria-label"]).toBe("Play audio")
	expect(media.play).toHaveBeenCalledTimes(2)
})

it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])(
	"keeps unavailable duration %s finite and unseekable",
	(duration) => {
		view().audio.props.onLoadedMetadata({ currentTarget: { duration } })
		expect(view().range.props).toMatchObject({ max: 0, disabled: true })
		expect(view().html).toContain("0:00 / 0:00")
	},
)
