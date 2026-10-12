import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createFieldSaver, createListSaver } from "./autosave"

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
})

describe("createFieldSaver", () => {
	it("retains the latest failure message through retry and clears it on success", async () => {
		const save = vi.fn(async (_value: string): Promise<{ ok: boolean; error?: string }> => ({ ok: true }))
		save.mockResolvedValueOnce({ ok: false, error: "Pick a time in the future." })
		save.mockResolvedValueOnce({ ok: false, error: '"Spring Hunt" is live. End it first.' })
		const saver = createFieldSaver({ save, onState: vi.fn() })
		saver.edit("First")
		await saver.flush()
		expect(saver.error).toBe("Pick a time in the future.")
		await saver.retry()
		expect(saver.error).toBe('"Spring Hunt" is live. End it first.')
		await saver.retry()
		expect(saver.error).toBeUndefined()
		expect(save.mock.calls).toEqual([["First"], ["First"], ["First"]])
	})

	it("clears a failed message when the edit returns to the saved value", async () => {
		const save = vi.fn(async (_value: string) => ({ ok: false, error: "Invalid value." }))
		const saver = createFieldSaver({ save, onState: vi.fn() })
		saver.sync("Initial")
		saver.edit("Failed")
		await saver.flush()
		saver.edit("Initial")
		expect(saver.error).toBeUndefined()
	})

	it("tracks an adopted server value without sending it", async () => {
		const save = vi.fn(async (_value: string) => ({ ok: true }))
		const saver = createFieldSaver({ save, onState: vi.fn() })
		saver.sync("Initial")
		saver.edit("Initial")
		await saver.blur()
		expect(save).not.toHaveBeenCalled()
		saver.edit("Changed")
		await saver.flush()
		saver.sync("Remote")
		saver.edit("Changed")
		await saver.flush()
		expect(save.mock.calls).toEqual([["Changed"], ["Changed"]])
	})
	it("saves once 500 ms after typing for one second at 200 ms intervals", async () => {
		const save = vi.fn(async (_value: string) => ({ ok: true }))
		const onState = vi.fn()
		const saver = createFieldSaver({ save, onState })

		for (let i = 0; i <= 5; i++) {
			if (i > 0) await vi.advanceTimersByTimeAsync(200)
			saver.edit(`Title ${i}`)
		}
		await vi.advanceTimersByTimeAsync(499)
		expect(save).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		expect(save.mock.calls).toEqual([["Title 5"]])
		expect(onState.mock.calls).toEqual([["pending"], ["saving"], ["saved"]])
	})

	it.each(["blur", "flush"] as const)("%s sends immediately and cancels the timer", async (method) => {
		const save = vi.fn(async (_value: string) => ({ ok: true }))
		const saver = createFieldSaver({ save, onState: vi.fn() })
		saver.edit("Title")
		saver[method]()
		expect(save).toHaveBeenCalledExactlyOnceWith("Title")
		expect(vi.getTimerCount()).toBe(0)
		await vi.advanceTimersByTimeAsync(1000)
		expect(save).toHaveBeenCalledTimes(1)
	})

	it("queues only the latest of three edits during one in-flight save", async () => {
		const first = deferred<{ ok: boolean }>()
		const save = vi.fn(async (_value: string) => ({ ok: true })).mockReturnValueOnce(first.promise)
		const saver = createFieldSaver({ save, onState: vi.fn() })
		saver.edit("First")
		const flushing = saver.flush()
		saver.edit("Second")
		saver.edit("Third")
		saver.edit("Last")
		await vi.advanceTimersByTimeAsync(500)
		expect(save.mock.calls).toEqual([["First"]])
		first.resolve({ ok: true })
		await flushing
		expect(save.mock.calls).toEqual([["First"], ["Last"]])
		expect(vi.getTimerCount()).toBe(0)
	})

	it("keeps the edit delay when an in-flight save finishes before the next timer", async () => {
		const first = deferred<{ ok: boolean }>()
		const save = vi.fn(async (_value: string) => ({ ok: true })).mockReturnValueOnce(first.promise)
		const onState = vi.fn()
		const saver = createFieldSaver({ save, onState })
		saver.edit("First")
		const flushing = saver.flush()
		saver.edit("Next")
		first.resolve({ ok: true })
		await flushing
		expect(onState).toHaveBeenLastCalledWith("pending")
		await vi.advanceTimersByTimeAsync(499)
		expect(save).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1)
		expect(save.mock.calls).toEqual([["First"], ["Next"]])
	})

	it("does not send an unchanged saved value or a pending edit reverted to it", async () => {
		const save = vi.fn(async (_value: string) => ({ ok: true }))
		const onState = vi.fn()
		const saver = createFieldSaver({ save, onState })
		await saver.flush()
		saver.edit("Title")
		await saver.flush()
		saver.edit("Title")
		saver.edit("Changed")
		saver.edit("Title")
		await vi.advanceTimersByTimeAsync(500)
		await saver.blur()
		expect(save.mock.calls).toEqual([["Title"]])
		expect(onState).toHaveBeenLastCalledWith("saved")
	})

	it("sends a reverted value when the different in-flight value succeeds", async () => {
		const next = deferred<{ ok: boolean }>()
		const save = vi.fn(async (_value: string) => ({ ok: true }))
		const saver = createFieldSaver({ save, onState: vi.fn() })
		saver.edit("Title")
		await saver.flush()
		save.mockReturnValueOnce(next.promise)
		saver.edit("Other")
		const flushing = saver.flush()
		saver.edit("Title")
		const reverting = saver.blur()
		expect(save.mock.calls).toEqual([["Title"], ["Other"]])
		next.resolve({ ok: true })
		await flushing
		await reverting
		expect(save.mock.calls).toEqual([["Title"], ["Other"], ["Title"]])
	})

	it.each(["result", "rejection"])("retains a failed value after %s and retries it", async (failure) => {
		const save = vi.fn(async (_value: string) => ({ ok: true }))
		if (failure === "result") save.mockResolvedValueOnce({ ok: false })
		else save.mockRejectedValueOnce(new Error("offline"))
		const onState = vi.fn()
		const saver = createFieldSaver({ save, onState })
		saver.edit("Title")
		await saver.flush()
		expect(onState).toHaveBeenLastCalledWith("failed")
		await vi.advanceTimersByTimeAsync(1000)
		expect(save).toHaveBeenCalledTimes(1)
		await saver.retry()
		expect(save.mock.calls).toEqual([["Title"], ["Title"]])
		expect(onState.mock.calls).toEqual([["pending"], ["saving"], ["failed"], ["saving"], ["saved"]])
		await saver.retry()
		expect(save).toHaveBeenCalledTimes(2)
	})

	it("sends a new edit on a failed field after the usual delay", async () => {
		const save = vi.fn(async (_value: string) => ({ ok: true })).mockResolvedValueOnce({ ok: false })
		const saver = createFieldSaver({ save, onState: vi.fn() })
		saver.edit("First")
		await saver.flush()
		saver.edit("Next")
		await vi.advanceTimersByTimeAsync(499)
		expect(save).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1)
		expect(save.mock.calls).toEqual([["First"], ["Next"]])
	})

	it("retains the latest edit when an in-flight save fails", async () => {
		const first = deferred<{ ok: boolean }>()
		const save = vi.fn(async (_value: string) => ({ ok: true })).mockReturnValueOnce(first.promise)
		const onState = vi.fn()
		const saver = createFieldSaver({ save, onState })
		saver.edit("First")
		const flushing = saver.flush()
		saver.edit("Latest")
		first.resolve({ ok: false })
		await flushing
		await vi.advanceTimersByTimeAsync(1000)
		expect(onState).toHaveBeenLastCalledWith("failed")
		expect(save).toHaveBeenCalledTimes(1)
		await saver.retry()
		expect(save.mock.calls).toEqual([["First"], ["Latest"]])
	})

	it("supports the configured delay", async () => {
		const save = vi.fn(async (_value: number) => ({ ok: true }))
		const saver = createFieldSaver({ save, onState: vi.fn(), delayMs: 100 })
		saver.edit(0)
		await vi.advanceTimersByTimeAsync(99)
		expect(save).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		expect(save).toHaveBeenCalledExactlyOnceWith(0)
	})
})

type AnswerOp = { op: "add" | "remove"; value: string }

function applyAnswer(items: string[], op: AnswerOp) {
	return op.op === "add" ? [...new Set([...items, op.value])] : items.filter((item) => item !== op.value)
}

describe("createListSaver", () => {
	it("sends operations one at a time in order and applies queued operations to local items", async () => {
		const first = deferred<{ ok: boolean }>()
		const patch = vi.fn(async (_op: AnswerOp) => ({ ok: true })).mockReturnValueOnce(first.promise)
		const onState = vi.fn()
		const saver = createListSaver({ patch, onState })
		const ops: AnswerOp[] = [
			{ op: "add", value: "lamp" },
			{ op: "add", value: "beacon" },
			{ op: "remove", value: "lamp" },
		]
		for (const op of ops) saver.enqueue(op)
		const items = ["lighthouse"]
		expect(saver.applyQueued(items, applyAnswer)).toEqual(["lighthouse", "beacon"])
		expect(items).toEqual(["lighthouse"])
		expect(patch.mock.calls).toEqual([[ops[0]]])
		first.resolve({ ok: true })
		await vi.advanceTimersByTimeAsync(0)
		expect(patch.mock.calls).toEqual(ops.map((op) => [op]))
		expect(onState.mock.calls).toEqual([["saving"], ["saved"]])
		expect(saver.applyQueued(["lighthouse", "beacon"], applyAnswer)).toEqual(["lighthouse", "beacon"])
	})

	it.each(["result", "rejection"])("blocks later operations after %s until retry", async (failure) => {
		const patch = vi.fn(async (_op: AnswerOp) => ({ ok: true }))
		if (failure === "result") patch.mockResolvedValueOnce({ ok: false })
		else patch.mockRejectedValueOnce(new Error("offline"))
		const onState = vi.fn()
		const saver = createListSaver({ patch, onState })
		const first: AnswerOp = { op: "add", value: "lamp" }
		const second: AnswerOp = { op: "remove", value: "old" }
		saver.enqueue(first)
		await vi.advanceTimersByTimeAsync(0)
		saver.enqueue(second)
		expect(onState).toHaveBeenLastCalledWith("failed")
		expect(patch.mock.calls).toEqual([[first]])
		expect(saver.applyQueued(["old"], applyAnswer)).toEqual(["lamp"])
		saver.retry()
		saver.retry()
		await vi.advanceTimersByTimeAsync(0)
		expect(patch.mock.calls).toEqual([[first], [first], [second]])
		expect(onState.mock.calls).toEqual([["saving"], ["failed"], ["saving"], ["saved"]])
		saver.retry()
		expect(patch).toHaveBeenCalledTimes(3)
	})
})
