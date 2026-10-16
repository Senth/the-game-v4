"use client"

import { type ReactNode, useState } from "react"

export function QuestViewToggle({ children, preview }: { children: ReactNode; preview: ReactNode }) {
	const [view, setView] = useState<"edit" | "preview">("edit")
	const previewing = view === "preview"

	return (
		<>
			<div className="sticky top-12 z-10 bg-z0 px-4 py-2 border-b border-z1 lg:hidden">
				<div className="grid grid-cols-2 rounded-md bg-z1 p-1 font-cond text-sm">
					<button
						type="button"
						aria-pressed={!previewing}
						className={`h-11 ${previewing ? "text-muted hover:text-head active:text-head" : "rounded bg-z2 text-head"} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
						onClick={() => setView("edit")}
					>
						Edit
					</button>
					<button
						type="button"
						aria-pressed={previewing}
						className={`h-11 ${previewing ? "rounded bg-z2 text-head" : "text-muted hover:text-head active:text-head"} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
						onClick={() => setView("preview")}
					>
						Preview
					</button>
				</div>
			</div>
			<div className={previewing ? "hidden lg:block" : undefined}>{children}</div>
			<div className={previewing ? "lg:hidden" : "hidden"}>{preview}</div>
		</>
	)
}
