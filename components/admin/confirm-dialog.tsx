"use client"

import { useEffect, useId, useRef } from "react"
import { createPortal } from "react-dom"
import { buttonClass } from "@/components/auth-form"

export const primaryClass = buttonClass
	.replace("h-12 w-full", "h-11")
	.replace("text-lg font-bold", "text-sm font-medium")
export const outlineClass =
	"h-11 rounded-md border px-3 font-cond text-sm text-ink hover:bg-z2/50 active:bg-z2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"

export function ConfirmDialog({
	open,
	title,
	body,
	confirmLabel,
	disabled = false,
	closeOnConfirm = true,
	error,
	onConfirm,
	onClose,
}: {
	open: boolean
	title: string
	body: string
	confirmLabel: string
	disabled?: boolean
	closeOnConfirm?: boolean
	error?: string | null
	onConfirm: () => void
	onClose: () => void
}) {
	const dialog = useRef<HTMLDialogElement>(null)
	const cancel = useRef<HTMLButtonElement>(null)
	const titleId = useId()
	const bodyId = useId()
	useEffect(() => {
		if (open) {
			dialog.current?.showModal()
			cancel.current?.focus()
		}
	}, [open])

	if (!open) return null

	return createPortal(
		<dialog
			ref={dialog}
			aria-labelledby={titleId}
			aria-describedby={bodyId}
			className="m-auto w-[calc(100%-var(--spacing)*12)] max-w-sm rounded-md bg-z1 p-5 text-ink backdrop:bg-z0/60"
			onClose={onClose}
		>
			<h2 id={titleId} className="font-head text-lg text-head">
				{title}
			</h2>
			<p id={bodyId} className="mt-2 font-body text-sm">
				{body}
			</p>
			{error && (
				<p role="alert" className="mt-2 font-cond text-xs text-warn">
					{error}
				</p>
			)}
			<div className="mt-5 grid grid-cols-2 gap-2">
				<button
					ref={cancel}
					type="button"
					className={`${outlineClass} border-z2`}
					onClick={() => dialog.current?.close()}
				>
					Cancel
				</button>
				<button
					type="button"
					className={primaryClass.replaceAll("accent", "pace-3")}
					disabled={disabled}
					onClick={() => {
						if (closeOnConfirm) dialog.current?.close()
						onConfirm()
					}}
				>
					{confirmLabel}
				</button>
			</div>
		</dialog>,
		document.body,
	)
}
