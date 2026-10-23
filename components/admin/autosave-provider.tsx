"use client"

import { useRouter, useSelectedLayoutSegments } from "next/navigation"
import { createContext, type ReactNode, useContext, useEffect, useEffectEvent, useState } from "react"
import { patchSeasonList, saveSeasonField } from "@/app/admin/autosave-actions"
import { seasonStatus } from "@/lib/domain/admin-seasons"
import type { Hint, HintInput, Season } from "@/lib/domain/schemas"
import { createLiveConnection } from "@/lib/events/live-connection"
import { type AutosaveState, createFieldSaver, createListSaver } from "./autosave"
import { useSeasonClock } from "./use-season-clock"

type Draft = {
	target: Record<string, string>
	saver: { cancel: () => void }
}

type DiscardTarget = { arcId: string; questId?: string; hintId?: string } | { field: "finisherBonuses"; index: string }

type SaveContext = {
	seasonId: string
	status: "saved" | "saving" | "failed" | null
	drafts: Map<string, Draft>
	listenersFor: (id: string) => Set<() => void>
	update: (id: string, state: AutosaveState, retry: () => void) => void
	remove: (id: string) => void
	discard: (target: DiscardTarget) => void
	retryAll: () => void
}

const AutosaveContext = createContext<SaveContext | null>(null)

export function useAutosave() {
	return useContext(AutosaveContext)
}

export function AutosaveProvider({
	seasonId,
	start,
	end,
	now,
	finisherBonuses,
	finishers,
	children,
}: Pick<Season, "finisherBonuses" | "finishers"> & {
	seasonId: string
	start: Date | null
	end: Date | null
	now: number
	children: ReactNode
}) {
	const router = useRouter()
	const [segment, selectedId] = useSelectedLayoutSegments()
	const teamId = segment === "teams" ? selectedId : undefined
	const refresh = useEffectEvent(() => router.refresh())
	const currentNow = useSeasonClock(now, start, end)
	const initialStatus = seasonStatus({ start, end }, new Date(now))
	const currentStatus = seasonStatus({ start, end }, new Date(currentNow))
	useEffect(() => {
		if (currentStatus !== initialStatus) refresh()
	}, [currentStatus, initialStatus])
	const [status, setStatus] = useState<SaveContext["status"]>(null)
	const [registry] = useState(() => {
		const fields = new Map<string, { state: AutosaveState; retry: () => void }>()
		const drafts = new Map<string, Draft>()
		const listeners = new Map<string, Set<() => void>>()
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
			listenersFor(id: string) {
				if (!listeners.has(id)) listeners.set(id, new Set())
				return listeners.get(id) as Set<() => void>
			},
			update(id: string, state: AutosaveState, retry: () => void) {
				fields.set(id, { state, retry })
				changed()
			},
			remove(id: string) {
				fields.delete(id)
				drafts.delete(id)
				changed()
			},
			discard(target: DiscardTarget) {
				for (const [id, draft] of drafts) {
					if (!Object.entries(target).every(([key, value]) => value === undefined || draft.target[key] === value))
						continue
					draft.saver.cancel()
					fields.delete(id)
					drafts.delete(id)
				}
				changed()
			},
			retryAll() {
				for (const field of fields.values()) if (field.state === "failed") field.retry()
			},
		}
	})

	useEffect(() => {
		for (const draft of registry.drafts.values()) {
			if (draft.target.field !== "finisherBonuses") continue
			const index = Number(draft.target.index)
			if (index >= finisherBonuses.length || finishers.some((finisher) => finisher.place === index + 1)) {
				registry.discard({ field: "finisherBonuses", index: String(index) })
			}
		}
	}, [finisherBonuses.length, finishers, registry])

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
		if (teamId) query.append("channel", `team:${teamId}`)
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
	}, [seasonId, teamId])

	return <AutosaveContext value={{ seasonId, status, ...registry }}>{children}</AutosaveContext>
}

export function autosaveId(seasonId: string, kind: "field" | "list" | "moves", target: Record<string, string>) {
	return JSON.stringify([
		seasonId,
		kind,
		Object.entries(target)
			.filter(([key]) => key !== "arcId" || !target.questId)
			.sort(([left], [right]) => left.localeCompare(right)),
	])
}

type FieldDraft<T> = Draft & {
	target: Parameters<typeof saveSeasonField>[1]
	value: T
	serverValue: T
	latestServerValue: T
	state: AutosaveState
	listeners: Set<() => void>
	focusedSubscribers: Set<object>
	saver: ReturnType<typeof createFieldSaver<T>>
}

function syncFieldDraft<T>(draft: FieldDraft<T>) {
	if (draft.focusedSubscribers.size || draft.state !== "saved" || Object.is(draft.latestServerValue, draft.serverValue))
		return
	draft.serverValue = draft.latestServerValue
	draft.value = draft.latestServerValue
	draft.saver.sync(draft.latestServerValue)
	for (const notify of draft.listeners) notify()
}

export function useAutosaveField<T>(target: Parameters<typeof saveSeasonField>[1], serverValue: T) {
	const context = useAutosave()
	if (!context) throw new Error("useAutosaveField requires AutosaveProvider")
	const { seasonId, drafts, listenersFor, update, remove } = context
	const id = autosaveId(seasonId, "field", target)
	const listId =
		"hintId" in target
			? autosaveId(seasonId, "list", { arcId: target.arcId, questId: target.questId, field: "hints" })
			: null
	const [draft] = useState(() => {
		const retained = drafts.get(id) as FieldDraft<T> | undefined
		if (retained) return retained
		const draft: FieldDraft<T> = {
			target,
			value: serverValue,
			serverValue,
			latestServerValue: serverValue,
			state: "saved",
			listeners: listenersFor(id),
			focusedSubscribers: new Set(),
			saver: createFieldSaver<T>({
				async save(value) {
					const list = listId ? (drafts.get(listId) as ListDraft | undefined) : undefined
					const queued = list?.saver.queued((op) => "hintId" in target && "hint" in op && op.hint.id === target.hintId)
					if (queued) {
						await list?.saver.retry()
						if (list?.state === "failed") return { ok: false }
						if (!(await queued.saved) || drafts.get(id) !== draft) return { ok: true }
					}
					const result = await saveSeasonField(seasonId, draft.target, value)
					if (result.ok) draft.serverValue = draft.latestServerValue
					return result
				},
				onState(next) {
					draft.state = next
					for (const notify of draft.listeners) notify()
					update(id, next, () => void draft.saver.retry())
					if (!draft.listeners.size && next === "saved") remove(id)
				},
			}),
		}
		draft.saver.sync(serverValue)
		drafts.set(id, draft)
		return draft
	})
	const { saver } = draft
	const [value, setValue] = useState(draft.value)
	const [state, setState] = useState(draft.state)
	const [subscriber] = useState(() => ({}))

	useEffect(() => {
		draft.target = target
	}, [draft, target])

	useEffect(() => {
		drafts.set(id, draft)
		const notify = () => {
			setValue(draft.value)
			setState(draft.state)
		}
		draft.listeners.add(notify)
		for (const notify of draft.listeners) notify()
		update(id, draft.state, () => void saver.retry())
		return () => {
			draft.listeners.delete(notify)
			draft.focusedSubscribers.delete(subscriber)
			if (draft.listeners.size) {
				syncFieldDraft(draft)
				return
			}
			if (draft.state === "pending" || draft.state === "saving") void saver.flush()
			else if (draft.state === "saved") remove(id)
		}
	}, [id, drafts, draft, update, remove, saver, subscriber])

	useEffect(() => {
		draft.latestServerValue = serverValue
		if (state === "saved") syncFieldDraft(draft)
	}, [serverValue, draft, state])

	return {
		value,
		onChange(next: T) {
			draft.value = next
			const list = listId ? (drafts.get(listId) as ListDraft | undefined) : undefined
			const queued = list?.saver.queued((op) => "hintId" in target && "hint" in op && op.hint.id === target.hintId)
			if (queued && "hint" in queued.op) {
				queued.op = { op: "add", hint: { ...queued.op.hint, [target.field]: next } }
				list?.notify?.()
			}
			for (const notify of draft.listeners) notify()
			saver.edit(next, queued !== undefined)
		},
		onFocus() {
			draft.focusedSubscribers.add(subscriber)
		},
		onBlur() {
			draft.focusedSubscribers.delete(subscriber)
			syncFieldDraft(draft)
			return saver.blur()
		},
		failed: state === "failed",
		error: saver.error,
	}
}

type ListTarget = Parameters<typeof patchSeasonList>[1]
type ListOp = Parameters<typeof patchSeasonList>[2]
type ListItem = string | Hint
type ListResult<T, Add> = { items: T[]; add(item: Add): Promise<boolean>; remove(id: string): void; failed: boolean }
type ListDraft = Draft & {
	target: ListTarget
	items: ListItem[]
	previewItems?: Hint[]
	serverItems: string
	state: AutosaveState
	listeners: Set<() => void>
	notify: () => void
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
	const { seasonId, drafts, listenersFor, update, remove } = context
	const id = autosaveId(seasonId, "list", target)
	const [draft] = useState(() => {
		const retained = drafts.get(id) as ListDraft | undefined
		if (retained) return retained
		const draft: ListDraft = {
			target,
			items: serverItems,
			serverItems: JSON.stringify(serverItems),
			state: "saved",
			listeners: listenersFor(id),
			notify() {
				for (const notify of draft.listeners) notify()
			},
			saver: createListSaver<ListOp>({
				async patch(op) {
					const result = await patchSeasonList(seasonId, draft.target, op)
					if (result.ok && drafts.get(id) === draft) {
						draft.items = applyList(draft.items, op)
						draft.notify?.()
					}
					return result
				},
				onState(next) {
					draft.state = next
					draft.notify?.()
					update(id, next, () => void draft.saver.retry())
					if (!draft.listeners.size && next === "saved") remove(id)
				},
			}),
		}
		drafts.set(id, draft)
		return draft
	})
	const { saver } = draft
	const [items, setItems] = useState(() => saver.applyQueued(draft.items, applyList))
	const [state, setState] = useState(draft.state)

	useEffect(() => {
		draft.target = target
	}, [draft, target])

	useEffect(() => {
		drafts.set(id, draft)
		const notify = () => {
			setState(draft.state)
			setItems(saver.applyQueued(draft.items, applyList))
		}
		draft.listeners.add(notify)
		draft.notify()
		update(id, draft.state, () => void saver.retry())
		return () => {
			draft.listeners.delete(notify)
			if (!draft.listeners.size && draft.state === "saved") remove(id)
		}
	}, [id, drafts, draft, update, remove, saver])

	useEffect(() => {
		const serialized = JSON.stringify(serverItems)
		if (serialized !== draft.serverItems) {
			draft.serverItems = serialized
			draft.items = serverItems
			delete draft.previewItems
			draft.notify()
		}
	}, [serverItems, draft])

	function enqueue(op: ListOp) {
		const saved = saver.enqueue(op)
		draft.notify()
		return saved
	}

	return {
		items,
		add(item: string | HintInput) {
			if (typeof item === "string") return enqueue({ op: "add", value: item })
			return enqueue({ op: "add", hint: { ...item, id: item.id ?? crypto.randomUUID() } })
		},
		remove(id: string) {
			enqueue(target.field === "answers" ? { op: "remove", value: id } : { op: "remove", hintId: id })
		},
		failed: state === "failed",
	}
}

type AssetTarget = { arcId: string; questId: string; field: "assetPath" }
type AssetDraft = Draft & {
	value: string | null
	serverValue: string | null
	state: "saved"
	listeners: Set<() => void>
}

function useDraftSubscriptions(ids: string[]) {
	const context = useAutosave()
	if (!context) throw new Error("Draft subscriptions require AutosaveProvider")
	const { drafts, listenersFor, remove } = context
	const [, rerender] = useState(0)
	const keys = JSON.stringify(ids)
	useEffect(() => {
		const notify = () => rerender((count) => count + 1)
		const subscribed = (JSON.parse(keys) as string[]).map((id) => ({ id, listeners: listenersFor(id) }))
		for (const { listeners } of subscribed) listeners.add(notify)
		notify()
		return () => {
			for (const { id, listeners } of subscribed) {
				listeners.delete(notify)
				const draft = drafts.get(id)
				if (!listeners.size && draft && "state" in draft && draft.state === "saved") remove(id)
			}
		}
	}, [keys, drafts, listenersFor, remove])
	return context
}

export function useDraftValue<T>(target: Parameters<typeof saveSeasonField>[1] | AssetTarget, serverValue: T): T {
	const context = useAutosave()
	if (!context) throw new Error("useDraftValue requires AutosaveProvider")
	const id = autosaveId(context.seasonId, "field", target)
	useDraftSubscriptions([id])
	const draft = context.drafts.get(id) as FieldDraft<T> | undefined
	return draft ? draft.value : serverValue
}

export function usePreviewHints(target: ListTarget & { field: "hints" }, items: Hint[]) {
	const context = useAutosave()
	if (!context) throw new Error("usePreviewHints requires AutosaveProvider")
	const { seasonId, drafts, listenersFor } = context
	const id = autosaveId(seasonId, "list", target)
	const previewId = autosaveId(seasonId, "field", { ...target, field: "previewHints" })
	useEffect(() => {
		const draft = drafts.get(id) as ListDraft | undefined
		if (!draft) return
		draft.previewItems = items
		for (const notify of listenersFor(previewId)) notify()
	}, [drafts, id, items, listenersFor, previewId])
}

export function useDraftHints(target: ListTarget & { field: "hints" }, serverItems: Hint[]): Hint[] {
	const context = useAutosave()
	if (!context) throw new Error("useDraftHints requires AutosaveProvider")
	const id = autosaveId(context.seasonId, "list", target)
	const previewId = autosaveId(context.seasonId, "field", { ...target, field: "previewHints" })
	const draft = context.drafts.get(id) as ListDraft | undefined
	const items = draft ? (draft.saver.applyQueued(draft.items, applyList) as Hint[]) : serverItems
	const fields = items.map((hint) =>
		autosaveId(context.seasonId, "field", { ...target, hintId: hint.id, field: "points" }),
	)
	useDraftSubscriptions([id, previewId, ...fields])
	if (draft?.previewItems) return draft.previewItems
	return items.map((hint, index) => {
		const id = fields[index]
		const field = (id ? context.drafts.get(id) : undefined) as FieldDraft<number> | undefined
		return field ? { ...hint, points: field.value } : hint
	})
}

export function useAssetDraft(target: AssetTarget, serverValue: string | null) {
	const context = useAutosave()
	if (!context) throw new Error("useAssetDraft requires AutosaveProvider")
	const id = autosaveId(context.seasonId, "field", target)
	const [draft] = useState(() => {
		const retained = context.drafts.get(id) as AssetDraft | undefined
		if (retained) return retained
		const draft: AssetDraft = {
			target,
			value: serverValue,
			serverValue,
			state: "saved",
			listeners: context.listenersFor(id),
			saver: { cancel() {} },
		}
		context.drafts.set(id, draft)
		return draft
	})
	useEffect(() => {
		context.drafts.set(id, draft)
	}, [context.drafts, id, draft])
	useEffect(() => {
		if (Object.is(serverValue, draft.serverValue)) return
		draft.value = draft.serverValue = serverValue
		for (const notify of draft.listeners) notify()
	}, [draft, serverValue])
	const value = useDraftValue(target, serverValue)
	return {
		value,
		onChange(next: string | null) {
			draft.value = next
			for (const notify of draft.listeners) notify()
		},
	}
}
