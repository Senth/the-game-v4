"use client"

import { useRouter } from "next/navigation"
import { createContext, type ReactNode, useContext, useEffect, useEffectEvent, useId, useRef, useState } from "react"
import { patchSeasonList, saveSeasonField } from "@/app/admin/autosave-actions"
import type { Hint, HintInput } from "@/lib/domain/schemas"
import { createLiveConnection } from "@/lib/events/live-connection"
import { type AutosaveState, createFieldSaver, createListSaver } from "./autosave"

type SaveContext = {
	seasonId: string
	status: "saved" | "saving" | "failed" | null
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
			update(id: string, state: AutosaveState, retry: () => void) {
				fields.set(id, { state, retry })
				changed()
			},
			remove(id: string) {
				fields.delete(id)
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

export function useAutosaveField<T>(target: Parameters<typeof saveSeasonField>[1], serverValue: T) {
	const context = useAutosave()
	if (!context) throw new Error("useAutosaveField requires AutosaveProvider")
	const { seasonId, update, remove } = context
	const id = useId()
	const [value, setValue] = useState(serverValue)
	const [state, setState] = useState<AutosaveState>("saved")
	const current = useRef({ state: "saved" as AutosaveState, focused: false, mounted: false })
	const [saver] = useState(() => {
		const saver = createFieldSaver<T>({
			save: (value) => saveSeasonField(seasonId, target, value),
			onState(next) {
				current.current.state = next
				if (current.current.mounted) setState(next)
				update(id, next, () => void saver.retry())
			},
		})
		saver.sync(serverValue)
		return saver
	})

	useEffect(() => {
		current.current.mounted = true
		update(id, current.current.state, () => void saver.retry())
		return () => {
			current.current.mounted = false
			if (current.current.state === "pending" || current.current.state === "saving") {
				void saver.flush().finally(() => remove(id))
			} else remove(id)
		}
	}, [id, update, remove, saver])

	useEffect(() => {
		if (!current.current.focused && current.current.state === "saved") {
			setValue(serverValue)
			saver.sync(serverValue)
		}
	}, [serverValue, saver])

	return {
		value,
		onChange(next: T) {
			setValue(next)
			saver.edit(next)
		},
		onFocus() {
			current.current.focused = true
		},
		onBlur() {
			current.current.focused = false
			return saver.blur()
		},
		failed: state === "failed",
	}
}

type ListTarget = Parameters<typeof patchSeasonList>[1]
type ListOp = Parameters<typeof patchSeasonList>[2]
type ListItem = string | Hint
type ListResult<T, Add> = { items: T[]; add(item: Add): void; remove(id: string): void; failed: boolean }

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
	const { seasonId, update, remove } = context
	const id = useId()
	const [items, setItems] = useState(serverItems)
	const [state, setState] = useState<AutosaveState>("saved")
	const current = useRef({ items: serverItems, state: "saved" as AutosaveState, mounted: false })
	const [saver] = useState(() =>
		createListSaver<ListOp>({
			async patch(op) {
				const result = await patchSeasonList(seasonId, target, op)
				if (result.ok) {
					current.current.items = applyList(current.current.items, op)
					if (current.current.mounted) setItems(saver.applyQueued(current.current.items, applyList))
				}
				return result
			},
			onState(next) {
				current.current.state = next
				if (current.current.mounted) {
					setState(next)
					setItems(saver.applyQueued(current.current.items, applyList))
				}
				update(id, next, () => void saver.retry())
				if (!current.current.mounted && next === "saved") remove(id)
			},
		}),
	)

	useEffect(() => {
		current.current.mounted = true
		update(id, current.current.state, () => void saver.retry())
		return () => {
			current.current.mounted = false
			if (current.current.state !== "saving") remove(id)
		}
	}, [id, update, remove, saver])

	useEffect(() => {
		current.current.items = serverItems
		setItems(saver.applyQueued(serverItems, applyList))
	}, [serverItems, saver])

	function enqueue(op: ListOp) {
		saver.enqueue(op)
		setItems(saver.applyQueued(current.current.items, applyList))
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
