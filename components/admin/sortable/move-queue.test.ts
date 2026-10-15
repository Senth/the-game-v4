import { expect, it, vi } from "vitest"
import { createMoveQueue } from "./move-queue"

type Move = { id: string; beforeId: string | null }
const apply = (items: string[], { id, beforeId }: Move) => {
	const rest = items.filter((item) => item !== id)
	const index = beforeId === null ? rest.length : rest.indexOf(beforeId)
	return [...rest.slice(0, index), id, ...rest.slice(index)]
}

function setup(
	save = vi.fn<(move: Move) => Promise<{ ok: boolean; conflict?: true }>>().mockResolvedValue({ ok: true }),
) {
	const onChange = vi.fn()
	const onState = vi.fn()
	const queue = createMoveQueue({ items: ["a", "b", "c"], apply, save, onChange, onState })
	return { queue, save, onChange, onState }
}

it("holds incoming lists during a drag and adopts the latest on cancellation", () => {
	const { queue } = setup()
	queue.setDragging(true)
	queue.sync(["c", "b", "a"])
	expect(queue.items).toEqual(["a", "b", "c"])
	queue.setDragging(false)
	expect(queue.items).toEqual(["c", "b", "a"])
})

it("holds optimistic order during a save, then releases and accepts server lists", async () => {
	let finish!: (result: { ok: boolean }) => void
	const { queue, onState } = setup(
		vi.fn(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		),
	)
	const saved = queue.move({ id: "c", beforeId: "a" })
	queue.sync(["a", "b", "c", "d"])
	expect(queue.items).toEqual(["c", "a", "b"])
	expect(queue.state).toBe("saving")
	finish({ ok: true })
	await saved
	expect(queue.items).toEqual(["c", "a", "b"])
	expect(onState.mock.calls.map(([state]) => state)).toEqual(["saving", "saved"])
	queue.sync(["b", "a", "c", "d"])
	expect(queue.items).toEqual(["b", "a", "c", "d"])
})

it.each(["failure", "throw"])("keeps local order after %s and retries the same move", async (failure) => {
	const save = vi.fn<(move: Move) => Promise<{ ok: boolean }>>()
	if (failure === "throw") save.mockRejectedValueOnce(new Error("offline"))
	else save.mockResolvedValueOnce({ ok: false })
	save.mockResolvedValue({ ok: true })
	const { queue } = setup(save)
	await queue.move({ id: "c", beforeId: "a" })
	queue.sync(["b", "a", "c"])
	expect(queue.items).toEqual(["c", "a", "b"])
	expect(queue.state).toBe("failed")
	await queue.retry()
	expect(save.mock.calls).toEqual([[{ id: "c", beforeId: "a" }], [{ id: "c", beforeId: "a" }]])
	expect(queue.items).toEqual(["c", "a", "b"])
	expect(queue.state).toBe("saved")
})

it("the next move retries a failed head before sending the new move", async () => {
	const save = vi
		.fn<(move: Move) => Promise<{ ok: boolean }>>()
		.mockResolvedValueOnce({ ok: false })
		.mockResolvedValue({ ok: true })
	const { queue } = setup(save)
	await queue.move({ id: "c", beforeId: "a" })
	await queue.move({ id: "b", beforeId: "c" })
	expect(save.mock.calls.map(([move]) => move.id)).toEqual(["c", "c", "b"])
	expect(queue.items).toEqual(["b", "c", "a"])
	expect(queue.state).toBe("saved")
})

it("serializes rapid moves and never releases while another drag is active", async () => {
	let finish!: (result: { ok: boolean }) => void
	const save = vi
		.fn<(move: Move) => Promise<{ ok: boolean }>>()
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		)
		.mockResolvedValue({ ok: true })
	const { queue } = setup(save)
	const first = queue.move({ id: "c", beforeId: "a" })
	const second = queue.move({ id: "b", beforeId: "c" })
	queue.setDragging(true)
	queue.sync(["a", "b", "c", "d"])
	expect(save).toHaveBeenCalledTimes(1)
	finish({ ok: true })
	await Promise.all([first, second])
	expect(queue.items).toEqual(["b", "c", "a"])
	queue.setDragging(false)
	expect(queue.items).toEqual(["b", "c", "a"])
	queue.sync(["b", "c", "a", "d"])
	expect(queue.items).toEqual(["b", "c", "a", "d"])
})

it("drops all pending order on conflict and requests a fresh server list", async () => {
	let finish!: (result: { ok: boolean; conflict?: true }) => void
	const { queue, save, onState } = setup(
		vi.fn(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		),
	)
	const first = queue.move({ id: "c", beforeId: "a" })
	const second = queue.move({ id: "b", beforeId: "c" })
	queue.sync(["b", "a", "c"])
	finish({ ok: false, conflict: true })
	await Promise.all([first, second])
	expect(queue.items).toEqual(["b", "a", "c"])
	expect(queue.state).toBe("saved")
	expect(save).toHaveBeenCalledOnce()
	expect(onState).toHaveBeenLastCalledWith("saved")
	queue.sync(["a", "c", "b"])
	expect(queue.items).toEqual(["a", "c", "b"])
})

it("cancellation ignores a late response and prevents further writes", async () => {
	let finish!: (result: { ok: boolean }) => void
	const { queue, save, onState } = setup(
		vi.fn(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		),
	)
	const pending = queue.move({ id: "c", beforeId: "a" })
	queue.cancel()
	onState.mockClear()
	finish({ ok: true })
	await pending
	await queue.move({ id: "b", beforeId: "a" })
	expect(save).toHaveBeenCalledOnce()
	expect(onState).not.toHaveBeenCalled()
})

it("a stale refresh during the second save cannot undo the first successful move", async () => {
	const finish: ((result: { ok: boolean }) => void)[] = []
	const { queue } = setup(
		vi.fn(
			() =>
				new Promise((resolve) => {
					finish.push(resolve)
				}),
		),
	)
	const first = queue.move({ id: "c", beforeId: "a" })
	const second = queue.move({ id: "b", beforeId: "c" })
	finish[0]?.({ ok: true })
	await vi.waitFor(() => expect(finish).toHaveLength(2))
	queue.sync(["a", "b", "c", "d"])
	finish[1]?.({ ok: true })
	await Promise.all([first, second])
	expect(queue.items).toEqual(["b", "c", "a"])
})
