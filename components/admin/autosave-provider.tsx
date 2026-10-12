"use client"

import { useRouter } from "next/navigation"
import { createContext, type ReactNode, useContext, useEffect, useEffectEvent, useState } from "react"
import { patchSeasonList, saveSeasonField } from "@/app/admin/autosave-actions"
import type { Hint, HintInput } from "@/lib/domain/schemas"
import { createLiveConnection } from "@/lib/events/live-connection"
import { type AutosaveState, createFieldSaver, createListSaver } from "./autosave"

type SaveContext = {
	seasonId: string
	status: "saved" | "saving" | "failed" | null
	drafts: Map<string, unknown>
	update: (id: string, state: AutosaveState, retry: () => void) => void
	remove: (id: string) => void
	retryAll: () => void
}

const AutosaveContext = createContext<SaveContext | null>(null)

export function useAutosave() {
	return useContext(AutosaveContext)
}

export function AutosaveProvider({ seasonId, children }: { seasonId: string; children: ReactNode }) {
	const router = useRouter()
	const refresh = useEffectEvent(() => router.refresh())
	const [status, setStatus] = useState<SaveContext["status"]>(null)
	const [registry] = useState(() => {
		const fields = new Map<string, { state: AutosaveState; retry: () => void }>()
		const drafts = new Map<string, unknown>()
		function changed() {
			const states = [...fields.values()].map((field) => field.state)
			setStatus(
				states.includes("failed")
					? "failed"
					: states.some((state) => state === "pending" || state === "saving")
						? "saving"
						: states.length
							? "saved"
							: null,
			)
		}
		return {
			drafts,
			update(id: string, state: AutosaveState, retry: () => void) {
				fields.set(id, { state, retry })
				changed()
			},
			remove(id: string) {
				fields.delete(id)
				drafts.delete(id)
				changed()
			},
			retryAll() {
				for (const field of fields.values()) if (field.state === "failed") field.retry()
			},
		}
	})

	useEffect(() => {
		window.addEventListener("online", registry.retryAll)
		return () => window.removeEventListener("online", registry.retryAll)
	}, [registry])

	useEffect(() => {
		if (status !== "saving" && status !== "failed") return
		const beforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault()
			event.returnValue = ""
		}
		window.addEventListener("beforeunload", beforeUnload)
		return () => window.removeEventListener("beforeunload", beforeUnload)
	}, [status])

	useEffect(() => {
		const query = new URLSearchParams({ channel: `season:${seasonId}` })
		const connection = createLiveConnection({
			url: `/api/events?${query}`,
			fetcher: async () => null,
			onData: () => refresh(),
			createEventSource: (url) => new EventSource(url),
		})
		const onVisibilityChange = () => connection.setHidden(document.hidden)
		document.addEventListener("visibilitychange", onVisibilityChange)
		if (document.hidden) connection.setHidden(true)
		connection.start()
		return () => {
			document.removeEventListener("visibilitychange", onVisibilityChange)
			connection.stop()
		}
	}, [seasonId])

	return <AutosaveContext value={{ seasonId, status, ...registry }}>{children}</AutosaveContext>
}

function autosaveId(seasonId: string, kind: "field" | "list", target: Record<string, string>) {
	return JSON.stringify([seasonId, kind, Object.entries(target).sort(([left], [right]) => left.localeCompare(right))])
}

type FieldDraft<T> = {
	value: T
	serverValue: T
	latestServerValue: T
	state: AutosaveState
	notify?: () => void
	saver: ReturnType<typeof createFieldSaver<T>>
}

export function useAutosaveField<T>(target: Parameters<typeof saveSeasonField>[1], serverValue: T) {
	const context = useAutosave()
	if (!context) throw new Error("useAutosaveField requires AutosaveProvider")
	const { seasonId, drafts, update, remove } = context
	const id = autosaveId(seasonId, "field", target)
	const [draft] = useState(() => {
		const retained = drafts.get(id) as FieldDraft<T> | undefined
		if (retained) return retained
		const draft: FieldDraft<T> = {
			value: serverValue,
			serverValue,
			latestServerValue: serverValue,
			state: "saved",
			saver: createFieldSaver<T>({
				async save(value) {
					const result = await saveSeasonField(seasonId, target, value)
					if (result.ok) draft.serverValue = draft.latestServerValue
					return result
				},
				onState(next) {
					draft.state = next
					draft.notify?.()
					update(id, next, () => void draft.saver.retry())
					if (!draft.notify && next === "saved") remove(id)
				},
			}),
		}
		draft.saver.sync(serverValue)
		return draft
	})
	const { saver } = draft
	const [value, setValue] = useState(draft.value)
	const [state, setState] = useState(draft.state)
	const [focused, setFocused] = useState(false)

	useEffect(() => {
		drafts.set(id, draft)
		draft.notify = () => setState(draft.state)
		update(id, draft.state, () => void saver.retry())
		return () => {
			draft.notify = undefined
			if (draft.state === "pending" || draft.state === "saving") void saver.flush()
			else if (draft.state === "saved") remove(id)
		}
	}, [id, drafts, draft, update, remove, saver])

	useEffect(() => {
		draft.latestServerValue = serverValue
		if (!focused && state === "saved" && draft.state === "saved" && !Object.is(serverValue, draft.serverValue)) {
			draft.serverValue = serverValue
			draft.value = serverValue
			setValue(serverValue)
			saver.sync(serverValue)
		}
	}, [serverValue, saver, draft, focused, state])

	return {
		value,
		onChange(next: T) {
			draft.value = next
			setValue(next)
			saver.edit(next)
		},
		onFocus() {
			setFocused(true)
		},
		onBlur() {
			setFocused(false)
			return saver.blur()
		},
		failed: state === "failed",
	}
}

type ListTarget = Parameters<typeof patchSeasonList>[1]
type ListOp = Parameters<typeof patchSeasonList>[2]
type ListItem = string | Hint
type ListResult<T, Add> = { items: T[]; add(item: Add): void; remove(id: string): void; failed: boolean }
type ListDraft = {
	items: ListItem[]
	serverItems: string
	state: AutosaveState
	notify?: () => void
	saver: ReturnType<typeof createListSaver<ListOp>>
}

function applyList(items: ListItem[], op: ListOp): ListItem[] {
	if ("value" in op) {
		return op.op === "add" ? [...new Set([...items, op.value])] : items.filter((item) => item !== op.value)
	}
	if (op.op === "remove") return items.filter((item) => typeof item === "string" || item.id !== op.hintId)
	return items.some((item) => typeof item !== "string" && item.id === op.hint.id) ? items : [...items, op.hint as Hint]
}

export function useAutosaveList(
	target: ListTarget & { field: "answers" },
	serverItems: string[],
): ListResult<string, string>
export function useAutosaveList(
	target: ListTarget & { field: "hints" },
	serverItems: Hint[],
): ListResult<Hint, HintInput>
export function useAutosaveList(target: ListTarget, serverItems: ListItem[]): ListResult<ListItem, string | HintInput> {
	const context = useAutosave()
	if (!context) throw new Error("useAutosaveList requires AutosaveProvider")
	const { seasonId, drafts, update, remove } = context
	const id = autosaveId(seasonId, "list", target)
	const [draft] = useState(() => {
		const retained = drafts.get(id) as ListDraft | undefined
		if (retained) return retained
		const draft: ListDraft = {
			items: serverItems,
			serverItems: JSON.stringify(serverItems),
			state: "saved",
			saver: createListSaver<ListOp>({
				async patch(op) {
					const result = await patchSeasonList(seasonId, target, op)
					if (result.ok) {
						draft.items = applyList(draft.items, op)
						draft.notify?.()
					}
					return result
				},
				onState(next) {
					draft.state = next
					draft.notify?.()
					update(id, next, () => void draft.saver.retry())
					if (!draft.notify && next === "saved") remove(id)
				},
			}),
		}
		return draft
	})
	const { saver } = draft
	const [items, setItems] = useState(() => saver.applyQueued(draft.items, applyList))
	const [state, setState] = useState(draft.state)

	useEffect(() => {
		drafts.set(id, draft)
		draft.notify = () => {
			setState(draft.state)
			setItems(saver.applyQueued(draft.items, applyList))
		}
		update(id, draft.state, () => void saver.retry())
		return () => {
			draft.notify = undefined
			if (draft.state === "saved") remove(id)
		}
	}, [id, drafts, draft, update, remove, saver])

	useEffect(() => {
		const serialized = JSON.stringify(serverItems)
		if (serialized !== draft.serverItems) {
			draft.serverItems = serialized
			draft.items = serverItems
			setItems(saver.applyQueued(serverItems, applyList))
		}
	}, [serverItems, saver, draft])

	function enqueue(op: ListOp) {
		saver.enqueue(op)
		setItems(saver.applyQueued(draft.items, applyList))
	}

	return {
		items,
		add(item: string | HintInput) {
			if (typeof item === "string") enqueue({ op: "add", value: item })
			else enqueue({ op: "add", hint: { ...item, id: item.id ?? crypto.randomUUID() } })
		},
		remove(id: string) {
			enqueue(target.field === "answers" ? { op: "remove", value: id } : { op: "remove", hintId: id })
		},
		failed: state === "failed",
	}
}
