import type { EffectCallback } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { AutosaveDatetimeField } from "./autosave-datetime-field"
import { AutosaveNumberField } from "./autosave-number-field"
import { useAutosaveField } from "./autosave-provider"
import { AutosaveSwitch, SeasonSwitch } from "./autosave-switch"
import { NewQuestPointsField } from "./new-quest-points-field"
import { RegistrationSwitch } from "./registration-switch"
import { NewPlaceRadiusField, SeasonSettings } from "./season-settings"
import { useSeasonClock } from "./use-season-clock"

const hooks = vi.hoisted(() => ({ mounted: false, effects: [] as EffectCallback[], setMounted: vi.fn() }))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: () => [hooks.mounted, hooks.setMounted],
	useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
	useId: () => "setting",
}))
vi.mock("./autosave-provider", () => ({ useAutosave: () => null, useAutosaveField: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("./use-season-clock", () => ({ useSeasonClock: vi.fn() }))
vi.mock("./registration-switch", () => ({ RegistrationSwitch: vi.fn(() => <p>Registration field</p>) }))
vi.mock("./map-area-field", () => ({ MapAreaField: () => <p>Map area field</p> }))

const now = new Date("2026-10-12T17:00:00Z").getTime()
const field = {
	value: null as unknown,
	onChange: vi.fn(),
	onFocus: vi.fn(),
	onBlur: vi.fn(async () => {}),
	failed: false,
	error: undefined,
}

beforeEach(() => {
	vi.clearAllMocks()
	hooks.mounted = true
	hooks.effects.length = 0
	vi.mocked(useAutosaveField).mockImplementation((_target, value) => ({ ...field, value }))
	vi.mocked(useSeasonClock).mockReturnValue(now)
})

it.each(["unscheduled", "upcoming"] as const)(
	"keeps Start editable while %s with minute step and correct helper",
	(status) => {
		const value = status === "upcoming" ? new Date(now + 20_000) : null
		const html = renderToStaticMarkup(<AutosaveDatetimeField serverValue={value} end={null} status={status} />)
		expect(useAutosaveField).toHaveBeenCalledWith({ field: "start" }, value)
		expect(html).toContain('type="datetime-local"')
		expect(html).toContain('step="60"')
		expect(html).toContain("Players see a countdown until then.")
		expect(html.includes("Clear")).toBe(status === "upcoming")
		expect(html).not.toContain("readonly")
	},
)

it("keeps server markup timezone-neutral then formats the start in browser local time, preserving seconds", () => {
	const value = new Date("2026-10-12T17:00:20Z")
	const props = { serverValue: value, end: null, status: "upcoming" as const }
	hooks.mounted = false
	expect(renderToStaticMarkup(<AutosaveDatetimeField {...props} />)).toContain('value=""')
	hooks.effects[0]?.()
	expect(hooks.setMounted).toHaveBeenCalledWith(true)
	hooks.mounted = true
	vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-120)
	expect(renderToStaticMarkup(<AutosaveDatetimeField {...props} />)).toContain('value="2026-10-12T19:00:20"')
	vi.restoreAllMocks()
})

it("parses edits in browser time, clears start to null and flushes Clear immediately", async () => {
	const value = new Date(now + 20_000)
	const element = AutosaveDatetimeField({ serverValue: value, end: null, status: "upcoming" })
	expect(element.type).not.toBe("div")
	element.props.onChange({ target: { value: "2026-10-24T19:00" } })
	expect(field.onChange).toHaveBeenCalledWith(new Date("2026-10-24T19:00"))
	element.props.onChange({ target: { value: "" } })
	expect(field.onChange).toHaveBeenCalledWith(null)
	element.props.onFocus()
	await element.props.onBlur()
	expect(field.onFocus).toHaveBeenCalledOnce()
	const clear = element.props.children
	expect(clear.props.className).toContain("min-h-11")
	clear.props.onClick()
	expect(field.onChange).toHaveBeenLastCalledWith(null)
	expect(field.onBlur).toHaveBeenCalledTimes(2)
})

it.each(["live", "ended"] as const)("renders Start as read-only text while %s", (status) => {
	const html = renderToStaticMarkup(
		<AutosaveDatetimeField serverValue={new Date(now)} end={new Date(now + 3_600_000)} status={status} />,
	)
	expect(html).toContain("Mon 12 Oct 2026, 19:00")
	expect(html).toContain(status === "live" ? "Ends 20:00." : "Ended 20:00.")
	expect(html).not.toContain("<input")
	expect(html).not.toContain("Clear")
})

it.each(["Pick a time in the future.", 'Overlaps "Spring Hunt", Sat 24 Oct 19:00–20:00.'])(
	"shows exact scheduling error %s and keeps the edited value",
	(error) => {
		vi.mocked(useAutosaveField).mockReturnValue({ ...field, value: new Date(now + 20_000), failed: true, error })
		const html = renderToStaticMarkup(<AutosaveDatetimeField serverValue={null} end={null} status="unscheduled" />)
		expect(html).toContain(error.replaceAll('"', "&quot;"))
		expect(html).toContain('aria-invalid="true"')
		expect(html).toContain('aria-describedby="setting-error"')
		expect(html).toContain("border-warn")
		expect(html).toContain('role="alert"')
		expect(html).not.toContain("Not saved")
		expect(html).not.toContain("Players see a countdown until then.")
	},
)

it.each([false, true])("renders Length with correct bounds, suffix and readOnly=%s", (readOnly) => {
	const html = renderToStaticMarkup(<AutosaveNumberField serverValue={60} readOnly={readOnly} />)
	expect(useAutosaveField).toHaveBeenCalledWith({ field: "lengthMinutes" }, 60)
	expect(html).toContain('type="number"')
	expect(html).toContain('min="1" max="1440" step="1"')
	expect(html).toContain("w-40")
	expect(html).toContain('value="60"')
	expect(html).toContain(">min</span>")
	expect(html.includes('readOnly=""')).toBe(readOnly)
	expect(html).toContain(
		readOnly ? "Set at start. Use −5 / +5 min while live." : "The game ends this long after start.",
	)
	if (readOnly) expect(html).toContain("border-z1")
})

it("autosaves numeric edits, preserves an empty edit and refuses edits while locked", () => {
	const input = AutosaveNumberField({ serverValue: 60, readOnly: false })
	input.props.onChange({ target: { value: "90", valueAsNumber: 90 } })
	expect(field.onChange).toHaveBeenCalledWith(90)
	input.props.onChange({ target: { value: "", valueAsNumber: Number.NaN } })
	expect(field.onChange).toHaveBeenLastCalledWith("")
	field.onChange.mockClear()
	AutosaveNumberField({ serverValue: 60, readOnly: true }).props.onChange({
		target: { value: "90", valueAsNumber: 90 },
	})
	expect(field.onChange).not.toHaveBeenCalled()
})

it("shows Length action errors instead of its helper", () => {
	vi.mocked(useAutosaveField).mockReturnValue({ ...field, value: 1441, failed: true, error: "Invalid value." })
	const html = renderToStaticMarkup(<AutosaveNumberField serverValue={60} readOnly={false} />)
	expect(html).toContain('value="1441"')
	expect(html).toContain("Invalid value.")
	expect(html).toContain("border-warn")
	expect(html).not.toContain("The game ends this long after start.")
})

it("renders New quest points with numeric bounds, suffix and value helper", () => {
	vi.mocked(useAutosaveField).mockReturnValue({ ...field, value: 30 })
	const html = renderToStaticMarkup(<NewQuestPointsField serverValue={30} />)
	expect(useAutosaveField).toHaveBeenCalledWith({ field: "defaultQuestPoints" }, 30)
	expect(html).toContain('type="number"')
	expect(html).toContain('inputMode="numeric"')
	expect(html).toContain('min="0" max="10000" step="1"')
	expect(html).toContain('value="30"')
	expect(html).toContain('placeholder="None"')
	expect(html).toContain(">p</span>")
	expect(html).toContain("New quests start with 30p. Existing quests never change.")
	expect(html).not.toContain("readOnly")
})

it("renders New place radius with its range error and existing-place helper", () => {
	vi.mocked(useAutosaveField).mockReturnValue({ ...field, value: 40 } as ReturnType<typeof useAutosaveField>)
	const fieldElement = NewPlaceRadiusField({ serverValue: 40 })
	const html = renderToStaticMarkup(fieldElement)
	expect(useAutosaveField).toHaveBeenCalledWith({ field: "placeRadius" }, 40)
	expect(html).toContain('min="5" max="500" step="1"')
	expect(html).toContain('value="40"')
	expect(html).toContain(">m</span>")
	expect(html).toContain("New places start with 40 m. Existing places never change.")
	vi.mocked(useAutosaveField).mockReturnValue({
		...field,
		value: 501,
		failed: true,
		error: "Use 5 to 500.",
	} as ReturnType<typeof useAutosaveField>)
	expect(renderToStaticMarkup(NewPlaceRadiusField({ serverValue: 40 }))).toContain("Use 5 to 500.")
})

it("renders an empty New quest points value and maps clear to null", () => {
	vi.mocked(useAutosaveField).mockReturnValue({ ...field, value: null })
	const html = renderToStaticMarkup(<NewQuestPointsField serverValue={null} />)
	expect(html).toContain('value=""')
	expect(html).toContain('placeholder="None"')
	expect(html).toContain("Empty means new quests start without points. Existing quests never change.")
	const input = NewQuestPointsField({ serverValue: 30 })
	input.props.onChange({ target: { value: "40", valueAsNumber: 40 } })
	expect(field.onChange).toHaveBeenCalledWith(40)
	input.props.onChange({ target: { value: "", valueAsNumber: Number.NaN } })
	expect(field.onChange).toHaveBeenLastCalledWith(null)
})

it.each(["live", "ended"] as const)("keeps New quest points editable while %s", (status) => {
	const season = {
		finisherBonuses: [],
		finishers: [],
		placeRadius: 40,
		_id: "s1",
		title: "Hunt",
		start: new Date(now - 1000),
		end: status === "ended" ? new Date(now) : new Date(now + 3_600_000),
		lengthMinutes: 60,
		defaultQuestPoints: 30,
		shuffleArcs: false,
		registrationOpen: true,
	}
	const html = renderToStaticMarkup(<SeasonSettings season={season} teams={[]} now={now} />)
	const pointsField = html.slice(html.indexOf(">New quest points</label>"), html.indexOf(">Shuffle arcs</span>"))
	expect(pointsField).toContain('value="30"')
	expect(pointsField).not.toContain("readOnly")
})

it.each([false, true])("uses native keyboard-activatable autosaved switch with checked=%s", (checked) => {
	const element = AutosaveSwitch({ serverValue: checked, started: false })
	const html = renderToStaticMarkup(element)
	expect(useAutosaveField).toHaveBeenCalledWith({ field: "shuffleArcs" }, checked)
	expect(html).toContain('<button type="button" role="switch"')
	expect(html).toContain(`aria-checked="${checked}"`)
	expect(html).toContain('aria-labelledby="setting-label"')
	expect(html).toContain("min-h-11")
	expect(html).toContain(checked ? ">On</button>" : ">Off</button>")
	element.props.onChange()
	expect(field.onChange).toHaveBeenCalledWith(!checked)
	element.props.onFocus()
	element.props.onBlur()
	expect(field.onFocus).toHaveBeenCalledOnce()
	expect(field.onBlur).toHaveBeenCalledOnce()
	const button = SeasonSwitch(element.props).props.children[1]
	expect(button.props.onClick).toBe(element.props.onChange)
	expect(button.props.onKeyDown).toBeUndefined()
})

it.each(["unscheduled", "upcoming", "live", "ended"] as const)(
	"orders fields and applies lifecycle helpers while %s",
	(status) => {
		const season = {
			finisherBonuses: [],
			finishers: [],
			placeRadius: 40,
			_id: "s1",
			title: "Cipher Night 2026",
			lengthMinutes: 60,
			defaultQuestPoints: null,
			shuffleArcs: true,
			registrationOpen: false,
			start: status === "unscheduled" ? null : new Date(status === "upcoming" ? now + 20_000 : now - 1000),
			end: status === "ended" ? new Date(now) : new Date(now + 3_600_000),
		}
		const html = renderToStaticMarkup(<SeasonSettings season={season} teams={[]} now={now} />)
		const started = status === "live" || status === "ended"
		expect(html).toContain('class="space-y-5 px-4 py-5 lg:px-8 lg:py-6"')
		expect(html.indexOf(">Title</label>")).toBeLessThan(html.indexOf(">Start</"))
		expect(html.indexOf(">Start</")).toBeLessThan(html.indexOf(">Length</label>"))
		expect(html.indexOf(">Length</label>")).toBeLessThan(html.indexOf(">New quest points</label>"))
		expect(html.indexOf(">New quest points</label>")).toBeLessThan(html.indexOf(">New place radius</label>"))
		expect(html.indexOf(">New place radius</label>")).toBeLessThan(html.indexOf("Map area field"))
		expect(html.indexOf("Map area field")).toBeLessThan(html.indexOf(">Shuffle arcs</span>"))
		expect(html.indexOf(">Shuffle arcs</span>")).toBeLessThan(html.indexOf("Registration field"))
		expect(html.includes("Applies to teams that join from now on.")).toBe(started)
		expect(html.includes("Each team plays the arcs in its own order.")).toBe(!started)
		expect(html.includes('readOnly=""')).toBe(started)
		expect(html).toContain('type="text"')
		expect(RegistrationSwitch).toHaveBeenCalledWith(
			expect.objectContaining({ seasonId: "s1", serverValue: false }),
			undefined,
		)
	},
)

it("locks Start and Length when the shared clock reaches scheduled start without a reload", () => {
	const season = {
		finisherBonuses: [],
		finishers: [],
		placeRadius: 40,
		_id: "s1",
		title: "Hunt",
		start: new Date(now + 1000),
		end: new Date(now + 3_601_000),
		lengthMinutes: 60,
		defaultQuestPoints: null,
		shuffleArcs: false,
		registrationOpen: true,
	}
	expect(renderToStaticMarkup(<SeasonSettings season={season} teams={[]} now={now} />)).toContain(
		'type="datetime-local"',
	)
	vi.mocked(useSeasonClock).mockReturnValue(now + 1000)
	const html = renderToStaticMarkup(<SeasonSettings season={season} teams={[]} now={now} />)
	expect(html).not.toContain('type="datetime-local"')
	expect(html).toContain('readOnly=""')
	expect(html).toContain("Applies to teams that join from now on.")
})
