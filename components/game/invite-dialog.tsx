"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { getJoinQr } from "@/app/actions"
import { TeamQrCode } from "@/components/team-qr-controls"

const quietClass =
	"mt-2 min-h-11 px-3 font-cond text-sm text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:text-ink"

type Qr = Awaited<ReturnType<typeof getJoinQr>>

export function InviteDialog({ onClose }: { onClose: () => void }) {
	const dialog = useRef<HTMLDialogElement>(null)
	const live = useRef(true)
	const titleId = useId()
	const [qr, setQr] = useState<Qr | "loading" | "failed">("loading")

	const load = useCallback(() => {
		setQr("loading")
		getJoinQr().then(
			(next) => {
				if (live.current) setQr(next)
			},
			() => {
				if (live.current) setQr("failed")
			},
		)
	}, [])

	useEffect(() => {
		const element = dialog.current
		if (!element) return
		live.current = true
		element.showModal()
		load()
		function backdrop(event: MouseEvent) {
			if (event.target === element) element?.close()
		}
		element.addEventListener("click", backdrop)
		return () => {
			live.current = false
			element.removeEventListener("click", backdrop)
		}
	}, [load])

	useEffect(() => {
		if (typeof qr === "object") dialog.current?.querySelector("button")?.focus()
	}, [qr])

	return createPortal(
		<dialog
			ref={dialog}
			aria-labelledby={titleId}
			className="m-auto w-[calc(100%-var(--spacing)*12)] max-w-sm rounded-md bg-z1 text-ink backdrop:bg-z0/60"
			onClose={onClose}
		>
			<div className="flex flex-col items-center p-5 text-center">
				<h2 id={titleId} className="mb-4 font-head text-lg font-medium text-head">
					Invite a teammate
				</h2>
				{qr === "failed" ? (
					<>
						<p role="alert" className="font-cond text-sm text-warn">
							Could not load the code. Try again.
						</p>
						<button type="button" onClick={load} className={quietClass}>
							Try again
						</button>
					</>
				) : qr === "loading" ? (
					<div className="flex size-56 items-center justify-center rounded-md bg-z2 font-cond text-sm text-ink">
						Loading…
					</div>
				) : (
					<TeamQrCode url={qr.url} svg={qr.svg} />
				)}
				<button type="button" onClick={() => dialog.current?.close()} className={quietClass}>
					Close
				</button>
			</div>
		</dialog>,
		document.body,
	)
}
