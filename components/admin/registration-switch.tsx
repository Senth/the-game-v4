"use client"

import { useEffect, useState } from "react"
import { setSeasonRegistration } from "@/app/admin/live-actions"
import { SeasonSwitch } from "./autosave-switch"

export function RegistrationSwitch({ seasonId, serverValue }: { seasonId: string; serverValue: boolean }) {
	const [open, setOpen] = useState(serverValue)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | undefined>()
	useEffect(() => setOpen(serverValue), [serverValue])
	async function toggle() {
		if (pending) return
		const next = !open
		setPending(true)
		setError(undefined)
		try {
			const result = await setSeasonRegistration(seasonId, next)
			if (result.ok) setOpen(next)
			else setError(result.error)
		} catch {
			setError("Not saved, retry")
		} finally {
			setPending(false)
		}
	}
	return (
		<SeasonSwitch
			label="Registration"
			checked={open}
			onChange={() => void toggle()}
			valueLabel={open ? "Open" : "Closed"}
			helper="New teams can sign up at /register."
			disabled={pending}
			failed={error !== undefined}
			error={error}
		/>
	)
}
