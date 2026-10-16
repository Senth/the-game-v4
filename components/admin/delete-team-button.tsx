"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { deleteTeamAction } from "@/app/admin/team-actions"
import { ConfirmDialog, outlineClass } from "./confirm-dialog"

export function DeleteTeamButton({ seasonId, teamId, name }: { seasonId: string; teamId: string; name: string }) {
	const router = useRouter()
	const [confirming, setConfirming] = useState(false)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function remove() {
		if (pending) return
		setPending(true)
		setError(null)
		try {
			const result = await deleteTeamAction(seasonId, teamId)
			if (result.ok) router.push(`/admin/seasons/${seasonId}/teams`)
			else setError(result.error)
		} catch {
			setError("Not saved, retry")
		} finally {
			setPending(false)
		}
	}

	return (
		<>
			<button
				type="button"
				className={`${outlineClass} w-full border-pace-3`}
				disabled={pending}
				onClick={() => {
					setError(null)
					setConfirming(true)
				}}
			>
				Delete team
			</button>
			<ConfirmDialog
				open={confirming}
				title={`Delete ${name}?`}
				body={`Its score and quest history are deleted. Every phone logged in as ${name} is logged out.`}
				confirmLabel="Delete team"
				disabled={pending}
				closeOnConfirm={false}
				error={error}
				onConfirm={remove}
				onClose={() => setConfirming(false)}
			/>
		</>
	)
}
