"use client"

import { type FormEvent, useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { PlayerPhone } from "@/lib/domain/player-game"

export type PhoneNameSaveResult = { phones: PlayerPhone[] } | { error: "taken" | "invalid" }
export type SavePhoneName = (name: string) => Promise<PhoneNameSaveResult>

export function NameDialog({
	teamName,
	name,
	onSaveName,
	onClose,
}: {
	teamName: string
	name: string
	onSaveName: SavePhoneName
	onClose: () => void
}) {
	const dialog = useRef<HTMLDialogElement>(null)
	const live = useRef(true)
	const titleId = useId()
	const helperId = useId()
	const [value, setValue] = useState(name)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<"taken" | "invalid" | "failed" | null>(null)

	useEffect(() => {
		const element = dialog.current
		if (!element) return
		live.current = true
		element.showModal()
		element.querySelector("input")?.focus()
		function backdrop(event: MouseEvent) {
			if (event.target === element) element?.close()
		}
		element.addEventListener("click", backdrop)
		return () => {
			live.current = false
			element.removeEventListener("click", backdrop)
		}
	}, [])

	async function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (saving) return
		setSaving(true)
		setError(null)
		try {
			const result = await onSaveName(value)
			if ("error" in result) {
				if (live.current) setError(result.error)
				return
			}
			dialog.current?.close()
		} catch {
			if (live.current) setError("failed")
		} finally {
			if (live.current) setSaving(false)
		}
	}

	const errorText =
		error === "taken"
			? `Someone on ${teamName} already uses that name.`
			: error === "invalid"
				? "Name must be 1–20 characters."
				: error === "failed"
					? "Could not save your name. Try again."
					: null

	return createPortal(
		<dialog
			ref={dialog}
			aria-labelledby={titleId}
			aria-describedby={helperId}
			className="m-auto w-[calc(100%-var(--spacing)*12)] max-w-sm rounded-md bg-z1 text-ink backdrop:bg-z0/60"
			onClose={onClose}
		>
			<form onSubmit={save} className="p-5">
				<h2 id={titleId} className="mb-4 text-center font-head text-lg font-medium text-head">
					Your name
				</h2>
				<label className="sr-only" htmlFor={`${titleId}-input`}>
					Your name
				</label>
				<input
					id={`${titleId}-input`}
					type="text"
					value={value}
					disabled={saving}
					autoComplete="off"
					onChange={(event) => {
						setValue(event.currentTarget.value)
						setError(null)
					}}
					aria-describedby={helperId}
					className="h-12 w-full rounded-md border border-link/40 bg-field px-3 font-body text-base text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
				/>
				<p id={helperId} className="mt-1.5 font-cond text-xs text-muted">
					Only {teamName} and the game masters see it. Leave it empty for a random name.
				</p>
				{errorText && (
					<p role="alert" className="mt-1.5 font-cond text-xs text-warn">
						{errorText}
					</p>
				)}
				<div className="mt-5 flex items-center justify-end gap-2">
					<button
						type="button"
						onClick={() => dialog.current?.close()}
						className="min-h-11 px-3 font-cond text-sm text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:text-ink"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={saving}
						className="h-11 rounded-md bg-accent px-5 font-cond font-bold text-white hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:bg-accent/80 disabled:opacity-50"
					>
						Save
					</button>
				</div>
			</form>
		</dialog>,
		document.body,
	)
}
