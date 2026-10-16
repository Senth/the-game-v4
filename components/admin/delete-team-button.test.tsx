import { beforeEach, expect, it, vi } from "vitest"
import { deleteTeamAction } from "@/app/admin/team-actions"
import { DeleteTeamButton } from "./delete-team-button"

const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0, push: vi.fn() }))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
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
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: hooks.push }) }))
vi.mock("@/app/admin/team-actions", () => ({ deleteTeamAction: vi.fn() }))

function render() {
	hooks.cursor = 0
	const element = DeleteTeamButton({ seasonId: "season", teamId: "ninjas", name: "Ninjas" })
	return { button: element.props.children[0], dialog: element.props.children[1] }
}

beforeEach(() => {
	vi.clearAllMocks()
	hooks.states.length = 0
	vi.mocked(deleteTeamAction).mockResolvedValue({ ok: true })
})

it("opens exact confirmation copy without deleting, and Cancel keeps team", () => {
	const closed = render()
	expect(closed.button.props.className).toContain("w-full")
	expect(closed.button.props.className).toContain("border-pace-3")
	expect(closed.button.props.className).toContain("h-11")
	expect(closed.button.props.children).toBe("Delete team")
	expect(closed.dialog.props.open).toBe(false)
	closed.button.props.onClick()
	const { dialog } = render()
	expect(dialog.props.open).toBe(true)
	expect(dialog.props.title).toBe("Delete Ninjas?")
	expect(dialog.props.body).toBe(
		"Its score and quest history are deleted. Every phone logged in as Ninjas is logged out.",
	)
	expect(dialog.props.confirmLabel).toBe("Delete team")
	expect(dialog.props.closeOnConfirm).toBe(false)
	dialog.props.onClose()
	expect(render().dialog.props.open).toBe(false)
	expect(deleteTeamAction).not.toHaveBeenCalled()
})

it("deletes only after confirmation, disables pending controls, then returns to list", async () => {
	let resolve!: (result: { ok: true }) => void
	vi.mocked(deleteTeamAction).mockReturnValueOnce(
		new Promise((done) => {
			resolve = done
		}),
	)
	render().button.props.onClick()
	const deletion = render().dialog.props.onConfirm()
	expect(deleteTeamAction).toHaveBeenCalledWith("season", "ninjas")
	expect(render().button.props.disabled).toBe(true)
	expect(render().dialog.props.disabled).toBe(true)
	expect(hooks.push).not.toHaveBeenCalled()
	resolve({ ok: true })
	await deletion
	expect(hooks.push).toHaveBeenCalledWith("/admin/seasons/season/teams")
})

it.each([false, true])("keeps confirmation open with error and retries after failure, network=%s", async (network) => {
	if (network) vi.mocked(deleteTeamAction).mockRejectedValueOnce(new Error("offline"))
	else vi.mocked(deleteTeamAction).mockResolvedValueOnce({ ok: false, error: "Team unavailable" })
	render().button.props.onClick()
	await render().dialog.props.onConfirm()
	const failed = render()
	expect(failed.dialog.props.open).toBe(true)
	expect(failed.dialog.props.error).toBe(network ? "Not saved, retry" : "Team unavailable")
	expect(failed.dialog.props.disabled).toBe(false)
	expect(hooks.push).not.toHaveBeenCalled()
	await failed.dialog.props.onConfirm()
	expect(render().dialog.props.error).toBeNull()
	expect(hooks.push).toHaveBeenCalledOnce()
})
