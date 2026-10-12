"use client"

import type { ReactNode } from "react"
import { useAutosave } from "./autosave-provider"

export function SaveStatus() {
	const context = useAutosave()
	if (!context?.status) return null
	if (context.status === "failed") {
		return (
			<button
				type="button"
				onClick={context.retryAll}
				className="min-h-11 px-3 font-cond text-sm text-warn hover:underline active:text-head focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
			>
				Not saved, <span className="underline">retry</span>
			</button>
		)
	}
	return (
		<span role="status" className="font-cond text-xs text-muted">
			{context.status === "saving" ? "Saving…" : "Saved"}
		</span>
	)
}

export function AutosaveHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
	const context = useAutosave()
	return (
		<header className={`${className} ${context?.status === "failed" ? "border-warn" : "border-z1"}`}>{children}</header>
	)
}
