import type { AutosaveState } from "../autosave"

export function createMoveQueue<Items, Move>({
	items: initialItems,
	apply,
	save,
	onChange,
	onState,
}: {
	items: Items
	apply: (items: Items, move: Move) => Items
	save: (move: Move) => Promise<{ ok: boolean; conflict?: true }>
	onChange: () => void
	onState: (state: AutosaveState) => void
}) {
	let items = initialItems
	let serverItems = initialItems
	let state: AutosaveState = "saved"
	let dragging = false
	let canceled = false
	let moved = false
	let running: Promise<void> | undefined
	const pending: Move[] = []

	function setState(next: AutosaveState) {
		state = next
		onState(next)
	}

	function adopt() {
		if (dragging || pending.length || canceled) return
		if (moved) serverItems = items
		else items = serverItems
		moved = false
		onChange()
	}

	async function drain() {
		setState("saving")
		while (pending.length && !canceled) {
			const move = pending[0] as Move
			let result: { ok: boolean; conflict?: true }
			try {
				result = await save(move)
			} catch {
				result = { ok: false }
			}
			if (canceled) return
			if (result.conflict) {
				pending.length = 0
				dragging = false
				moved = false
				adopt()
				setState("saved")
				return
			}
			if (!result.ok) {
				setState("failed")
				return
			}
			pending.shift()
		}
		if (canceled) return
		adopt()
		setState("saved")
	}

	function send() {
		if (canceled || !pending.length) return Promise.resolve()
		if (running) return running
		running = drain().finally(() => {
			running = undefined
		})
		return running
	}

	return {
		get items() {
			return items
		},
		get state() {
			return state
		},
		sync(next: Items) {
			serverItems = next
			adopt()
		},
		setDragging(active: boolean) {
			dragging = active
			adopt()
		},
		move(move: Move) {
			if (canceled) return Promise.resolve()
			pending.push(move)
			moved = true
			items = apply(items, move)
			onChange()
			return send()
		},
		retry: send,
		cancel() {
			canceled = true
			pending.length = 0
		},
	}
}
