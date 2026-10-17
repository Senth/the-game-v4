"use client"

import Link from "next/link"
import { type ReactNode, useEffect, useId, useRef } from "react"
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
	cancelLabel = "Cancel",
	confirmLabel,
	confirmTone = "danger",
	disabled = false,
	closeOnConfirm = true,
	error,
	result,
	onConfirm,
	onClose,
}: {
	open: boolean
	title: string
	body: ReactNode
	cancelLabel?: string
	confirmLabel?: string
	confirmTone?: "accent" | "danger"
	disabled?: boolean
	closeOnConfirm?: boolean
	error?: string | null
	result?: { label: string; href: string }
	onConfirm: () => void
	onClose: () => void
}) {
	const dialog = useRef<HTMLDialogElement>(null)
	const cancel = useRef<HTMLButtonElement>(null)
	const titleId = useId()
	const bodyId = useId()
	const confirmClass = confirmTone === "accent" ? primaryClass : primaryClass.replaceAll("accent", "pace-3")
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
			<div id={bodyId} className="mt-2 font-body text-sm">
				{body}
			</div>
			{error && (
				<p role="alert" className="mt-2 font-cond text-xs text-warn">
					{error}
				</p>
			)}
			<div className={`mt-5 ${confirmLabel || result ? "grid grid-cols-2 gap-2" : "flex justify-end"}`}>
				<button
					ref={cancel}
					type="button"
					className={`${outlineClass} border-z2`}
					onClick={() => dialog.current?.close()}
				>
					{cancelLabel}
				</button>
				{result ? (
					<Link
						href={result.href}
						className={`${outlineClass.replace("text-ink", "text-link")} border-z2`}
						onClick={() => dialog.current?.close()}
					>
						{result.label}
					</Link>
				) : confirmLabel ? (
					<button
						type="button"
						className={confirmClass}
						disabled={disabled}
						onClick={() => {
							if (closeOnConfirm) dialog.current?.close()
							onConfirm()
						}}
					>
						{confirmLabel}
					</button>
				) : null}
			</div>
		</dialog>,
		document.body,
	)
}
