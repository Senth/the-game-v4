"use client"

import { type ReactNode, useActionState, useEffect, useId, useRef, useState } from "react"
import { type CreateSeasonState, createSeasonAction } from "@/app/admin/actions"
import { inputClass, labelClass } from "@/components/auth-form"

export function NewSeasonForm({ variant, children }: { variant: "menu" | "header"; children?: ReactNode }) {
	const [open, setOpen] = useState(false)
	const [title, setTitle] = useState("")
	const [state, action, pending] = useActionState<CreateSeasonState, FormData>(createSeasonAction, {})
	const input = useRef<HTMLInputElement>(null)
	const id = useId()
	useEffect(() => {
		if (open) input.current?.focus()
	}, [open])
	const trigger = (
		<button
			type="button"
			onClick={() => setOpen(true)}
			className={
				variant === "menu"
					? "ml-4 min-h-11 text-sm text-link hover:underline active:text-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
					: "min-h-11 shrink-0 rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90 active:bg-accent/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
			}
		>
			{variant === "menu" ? "+ New season" : "New season"}
		</button>
	)
	return (
		<>
			{variant === "header" ? (
				<header className="flex min-h-12 items-center gap-3 border-b border-z1 px-4 font-cond text-sm">
					{children}
					{!open && trigger}
				</header>
			) : (
				!open && trigger
			)}
			{open && (
				<form
					action={action}
					className={
						variant === "menu"
							? "border-b border-z1 px-4 pt-2 pb-3"
							: "mx-auto max-w-2xl border-b border-z1 px-4 pt-5 pb-4"
					}
					onKeyDown={(event) => {
						if (event.key === "Escape" && !pending) setOpen(false)
					}}
					onBlur={(event) => {
						if (!title.trim() && !pending && !state.error && !event.currentTarget.contains(event.relatedTarget))
							setOpen(false)
					}}
				>
					<label htmlFor={id} className={variant === "header" ? labelClass : "sr-only"}>
						New season
					</label>
					<div className="flex gap-2">
						<input
							ref={input}
							id={id}
							name="title"
							placeholder="Season title"
							value={title}
							onChange={(event) => setTitle(event.target.value)}
							disabled={pending}
							aria-invalid={!!state.error}
							aria-describedby={state.error ? `${id}-error` : undefined}
							className={`${inputClass} min-w-0 flex-1 font-body text-sm disabled:opacity-60`}
						/>
						<button
							type="submit"
							disabled={pending}
							className="min-h-11 shrink-0 rounded-md bg-accent px-4 font-cond text-sm font-medium text-white hover:bg-accent/90 active:bg-accent/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
						>
							{pending ? "Creating…" : "Create"}
						</button>
					</div>
					{state.error && (
						<p id={`${id}-error`} role="alert" className="mt-2 font-cond text-sm text-warn">
							{state.error}
						</p>
					)}
				</form>
			)}
		</>
	)
}
