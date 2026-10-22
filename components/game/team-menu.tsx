"use client"

import { useEffect, useId, useRef, useState } from "react"
import { InviteDialog } from "./invite-dialog"

export function TeamMenu({ teamName }: { teamName: string }) {
	const [open, setOpen] = useState(false)
	const [inviting, setInviting] = useState(false)
	const root = useRef<HTMLDivElement>(null)
	const button = useRef<HTMLButtonElement>(null)
	const item = useRef<HTMLButtonElement>(null)
	const menuId = useId()

	function close() {
		setOpen(false)
		button.current?.focus()
	}

	useEffect(() => {
		if (!open) return
		item.current?.focus()
		function dismiss() {
			setOpen(false)
			button.current?.focus()
		}
		function outside(event: PointerEvent) {
			if (!root.current?.contains(event.target as Node)) dismiss()
		}
		function keydown(event: KeyboardEvent) {
			if (event.key === "Escape") dismiss()
		}
		document.addEventListener("pointerdown", outside)
		document.addEventListener("keydown", keydown)
		return () => {
			document.removeEventListener("pointerdown", outside)
			document.removeEventListener("keydown", keydown)
		}
	}, [open])

	return (
		<div ref={root} className="relative -mr-3 ml-1">
			<button
				ref={button}
				type="button"
				aria-label="Team menu"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				onClick={() => (open ? close() : setOpen(true))}
				className={`flex size-11 items-center justify-center hover:text-head focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${open ? "text-head" : "text-link"}`}
			>
				<svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
					<circle cx="12" cy="5" r="1.8" />
					<circle cx="12" cy="12" r="1.8" />
					<circle cx="12" cy="19" r="1.8" />
				</svg>
			</button>
			{open && (
				<div
					id={menuId}
					role="menu"
					aria-label={teamName}
					className="absolute top-full right-0 z-30 min-w-52 rounded-md bg-z1 py-1 shadow-lg shadow-z0"
				>
					<p aria-hidden="true" className="px-4 pt-2 pb-1 font-cond text-xs uppercase tracking-wider text-muted">
						{teamName}
					</p>
					<button
						ref={item}
						type="button"
						role="menuitem"
						onClick={() => {
							close()
							setInviting(true)
						}}
						className="flex min-h-11 w-full items-center px-4 text-left font-cond text-sm text-ink hover:bg-z2/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent active:bg-z2"
					>
						Invite a teammate
					</button>
				</div>
			)}
			{inviting && <InviteDialog onClose={() => setInviting(false)} />}
		</div>
	)
}
