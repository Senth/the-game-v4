"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { autosaveId, useAutosave } from "../autosave-provider"
import { createMoveQueue } from "./move-queue"

type MoveDraft<Items, Move> = {
	target: Record<string, string>
	listeners: Set<() => void>
	saver: ReturnType<typeof createMoveQueue<Items, Move>>
}

export function useMoveQueue<Items, Move>(
	target: Record<string, string>,
	serverItems: Items,
	apply: (items: Items, move: Move) => Items,
	save: (move: Move) => Promise<{ ok: boolean; conflict?: true }>,
) {
	const context = useAutosave()
	if (!context) throw new Error("useMoveQueue requires AutosaveProvider")
	const { seasonId, drafts, update, remove } = context
	const router = useRouter()
	const id = autosaveId(seasonId, "moves", target)
	const [draft] = useState(() => {
		const retained = drafts.get(id) as MoveDraft<Items, Move> | undefined
		if (retained) return retained
		const draft: MoveDraft<Items, Move> = {
			target,
			listeners: new Set(),
			saver: createMoveQueue({
				items: serverItems,
				apply,
				save,
				onChange() {
					for (const notify of draft.listeners) notify()
				},
				onState(state) {
					for (const notify of draft.listeners) notify()
					update(id, state, () => void draft.saver.retry())
					if (state === "saved") router.refresh()
					if (!draft.listeners.size && state === "saved") remove(id)
				},
			}),
		}
		drafts.set(id, draft)
		return draft
	})
	const { saver } = draft
	const [, rerender] = useState(0)

	useEffect(() => {
		drafts.set(id, draft)
		const notify = () => rerender((count) => count + 1)
		draft.listeners.add(notify)
		update(id, saver.state, () => void saver.retry())
		return () => {
			draft.listeners.delete(notify)
			if (draft.listeners.size) return
			saver.setDragging(false)
			if (saver.state === "saved") remove(id)
		}
	}, [id, drafts, draft, saver, update, remove])

	useEffect(() => saver.sync(serverItems), [saver, serverItems])

	return { items: saver.items, move: saver.move, setDragging: saver.setDragging, failed: saver.state === "failed" }
}
