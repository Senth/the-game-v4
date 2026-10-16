import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { type CreateTeamState, createTeamAction } from "@/app/admin/team-actions"
import type { AdminTeamRow } from "@/lib/domain/admin-teams"
import { AddTeamForm, TeamRow, TeamsList } from "./teams-list"

const hooks = vi.hoisted(() => ({
	values: [] as string[],
	cursor: 0,
	result: {} as CreateTeamState,
	pending: false,
}))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: string) => {
		const index = hooks.cursor++
		hooks.values[index] ??= initial
		return [
			hooks.values[index],
			(value: string) => {
				hooks.values[index] = value
			},
		]
	},
	useId: () => "add-team",
	useActionState: (reducer: (state: CreateTeamState, data: FormData) => Promise<CreateTeamState>) => [
		hooks.result,
		async (data: FormData) => {
			hooks.result = await reducer(hooks.result, data)
		},
		hooks.pending,
	],
}))
vi.mock("@/app/admin/team-actions", () => ({ createTeamAction: vi.fn() }))

const row: AdminTeamRow = {
	id: "ninjas",
	name: "Ninjas",
	rank: 7,
	score: 64,
	hintLoss: 25,
	rail: [
		{
			arcId: "lighthouse",
			segments: [
				{ questId: "solved", state: "solved" },
				{ questId: "current", state: "current" },
				{ questId: "todo", state: "todo" },
			],
		},
	],
	status: { kind: "on", quest: "Backwards log" },
}

function form() {
	hooks.cursor = 0
	const element = AddTeamForm({ seasonId: "season" })
	const controls = element.props.children[0].props.children
	return { element, name: controls[1], password: controls[3], submit: controls[4] }
}

beforeEach(() => {
	vi.clearAllMocks()
	hooks.values.length = 0
	hooks.result = {}
	hooks.pending = false
	vi.mocked(createTeamAction).mockResolvedValue({ ok: true })
})

it("renders one whole running row link with quiet rank, hint loss, points, current rail and status", () => {
	const html = renderToStaticMarkup(<TeamRow seasonId="season" row={row} />)
	expect(html).toContain('href="/admin/seasons/season/teams/ninjas"')
	expect(html).toContain('w-5 shrink-0 text-xs text-muted">7</span>')
	expect(html).toContain('text-warn">−25p hints</span>')
	expect(html).toContain("text-head font-bold")
	expect(html).toContain("64p")
	expect(html).toContain('aria-current="step"')
	expect(html).toContain("bg-pace-ok")
	expect(html).toContain("bg-accent")
	expect(html).toContain("On <span")
	expect(html).toContain("Backwards log")
	expect(html).toContain("min-h-11")
	expect(html).toContain("min-w-0 flex-1 truncate")
	expect(html).not.toMatch(/<button|<input|<table|<h2/)
})

it("hides rank and status before start and quiets no hints", () => {
	const html = renderToStaticMarkup(
		<TeamRow seasonId="season" row={{ ...row, rank: null, hintLoss: 0, rail: [], status: { kind: "before" } }} />,
	)
	expect(html).not.toContain("w-5")
	expect(html).not.toContain("<p")
	expect(html).toContain('text-muted">no hints</span>')
})

it("reuses row content as a noninteractive summary without a chevron", () => {
	const html = renderToStaticMarkup(<TeamRow seasonId="season" row={row} summary />)
	expect(html).toContain("64p")
	expect(html).toContain("−25p hints")
	expect(html).toContain("Backwards log")
	expect(html).not.toMatch(/<a|›|hover:|focus-visible:/)
})

it.each([
	[{ kind: "finished" }, "Finished every quest"],
	[{ kind: "stopped", quest: "The vault" }, "Stopped on <span"],
] as const)("renders %j status", (status, copy) => {
	const html = renderToStaticMarkup(<TeamRow seasonId="season" row={{ ...row, status }} />)
	expect(html).toContain(copy)
	if (status.kind === "stopped") expect(html).toContain("The vault")
})

it("keeps inline add before the empty state and renders every supplied row without management controls", () => {
	const empty = renderToStaticMarkup(<TeamsList seasonId="season" rows={[]} />)
	expect(empty.indexOf("<form")).toBeLessThan(empty.indexOf("No teams yet."))
	expect(empty).not.toContain("<h2")
	const html = renderToStaticMarkup(
		<TeamsList
			seasonId="season"
			rows={Array.from({ length: 10 }, (_, index) => ({ ...row, id: String(index), name: "A".repeat(30) }))}
		/>,
	)
	expect(html.match(/<li>/g)).toHaveLength(10)
	expect(html.match(/href="\/admin\/seasons\/season\/teams\//g)).toHaveLength(10)
	expect(html.match(/<button/g)).toHaveLength(1)
	expect(html).not.toContain("Delete")
})

it("labels both 44 px inputs and leaves password visible without autocomplete", () => {
	const { element, name, password, submit } = form()
	const html = renderToStaticMarkup(element)
	expect(html).toContain('class="sr-only">Team name</label>')
	expect(html).toContain('class="sr-only">Password</label>')
	expect(name.props.name).toBe("name")
	expect(password.props.name).toBe("password")
	expect(password.props.type).toBe("text")
	expect(password.props.autoComplete).toBe("off")
	expect(name.props.className).toContain("h-11")
	expect(password.props.className).toContain("h-11")
	expect(password.props.className).toContain("w-24")
	expect(password.props.className).not.toContain("w-full")
	expect(submit.props.className).toContain("min-h-11")
	expect(submit.props.children).toBe("Add")
})

it("keeps both values and announces errors, then clears both values on successful add", async () => {
	form().name.props.onChange({ target: { value: "Ninjas" } })
	form().password.props.onChange({ target: { value: "secret" } })
	const data = new FormData()
	data.set("name", "Ninjas")
	data.set("password", "secret")
	vi.mocked(createTeamAction).mockResolvedValueOnce({
		ok: false,
		error: "Ninjas is taken this season. Pick another name.",
	})
	await form().element.props.action(data)
	expect(createTeamAction).toHaveBeenCalledWith("season", {}, data)
	const failed = form()
	expect(failed.name.props.value).toBe("Ninjas")
	expect(failed.password.props.value).toBe("secret")
	expect(failed.name.props["aria-invalid"]).toBe(true)
	expect(failed.password.props["aria-describedby"]).toBe("add-team-error")
	expect(renderToStaticMarkup(failed.element)).toContain('role="alert"')
	expect(renderToStaticMarkup(failed.element)).toContain("Ninjas is taken this season. Pick another name.")
	await failed.element.props.action(data)
	expect(form().name.props.value).toBe("")
	expect(form().password.props.value).toBe("")
	expect(renderToStaticMarkup(form().element)).not.toContain('role="alert"')
})

it("disables both inputs and submit while adding", () => {
	hooks.pending = true
	const { name, password, submit } = form()
	expect(name.props.disabled).toBe(true)
	expect(password.props.disabled).toBe(true)
	expect(submit.props.disabled).toBe(true)
	expect(submit.props.children).toBe("Adding…")
})
