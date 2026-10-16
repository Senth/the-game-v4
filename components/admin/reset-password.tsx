"use client"

import { unstable_rethrow } from "next/navigation"
import { useActionState, useId, useState } from "react"
import { type CreateTeamState, resetTeamPasswordAction } from "@/app/admin/team-actions"
import { inputClass } from "@/components/auth-form"
import { outlineClass } from "./confirm-dialog"

const linkClass =
	"min-h-11 font-cond text-sm text-link hover:underline active:text-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"

function ResetPasswordForm({
	seasonId,
	teamId,
	close,
}: {
	seasonId: string
	teamId: string
	close: (changed: boolean) => void
}) {
	const [password, setPassword] = useState("")
	const [state, action, pending] = useActionState<CreateTeamState, FormData>(async (previous, data) => {
		try {
			const result = await resetTeamPasswordAction(seasonId, teamId, previous, data)
			if (result.ok) close(true)
			return result
		} catch (error) {
			unstable_rethrow(error)
			return { ok: false, error: "Not saved, retry" }
		}
	}, {})
	const id = useId()
	function cancel() {
		if (pending) return
		setPassword("")
		close(false)
	}
	return (
		<form
			action={action}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault()
					cancel()
				}
			}}
		>
			<label htmlFor={id} className="block font-cond text-sm text-muted">
				Reset password
			</label>
			<input
				id={id}
				name="password"
				type="text"
				autoComplete="off"
				minLength={4}
				required
				value={password}
				onChange={(event) => setPassword(event.target.value)}
				disabled={pending}
				aria-invalid={!!state.error}
				aria-describedby={`${id}-helper${state.error ? ` ${id}-error` : ""}`}
				className={`${inputClass} mt-1 disabled:opacity-60`}
			/>
			<p id={`${id}-helper`} className="mt-2 font-cond text-xs text-muted">
				Phones already logged in stay in. Old QR links stop working.
			</p>
			{state.error && (
				<p id={`${id}-error`} role="alert" className="mt-2 font-cond text-sm text-warn">
					{state.error}
				</p>
			)}
			<div className="mt-3 flex items-center justify-end gap-4">
				<button type="button" onClick={cancel} disabled={pending} className={linkClass}>
					Cancel
				</button>
				<button type="submit" disabled={pending} className={`${outlineClass} border-z2`}>
					{pending ? "Setting…" : "Set password"}
				</button>
			</div>
		</form>
	)
}

export function ResetPassword({ seasonId, teamId }: { seasonId: string; teamId: string }) {
	const [open, setOpen] = useState(false)
	const [changed, setChanged] = useState(false)
	return (
		<div className="px-4 pt-6">
			{open ? (
				<ResetPasswordForm
					seasonId={seasonId}
					teamId={teamId}
					close={(changed) => {
						setOpen(false)
						setChanged(changed)
					}}
				/>
			) : (
				<div className="flex flex-wrap items-center gap-x-3">
					<button
						type="button"
						className={linkClass}
						onClick={() => {
							setChanged(false)
							setOpen(true)
						}}
					>
						Reset password
					</button>
					{changed && (
						<p role="status" className="font-cond text-sm text-muted">
							Password changed.
						</p>
					)}
				</div>
			)}
		</div>
	)
}
