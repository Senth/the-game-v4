"use client"

import Link from "next/link"
import { useActionState, useId, useState } from "react"
import { type CreateTeamState, createTeamAction } from "@/app/admin/team-actions"
import { inputClass } from "@/components/auth-form"
import { ArcRail } from "@/components/game/arc-rail"
import type { AdminTeamRow } from "@/lib/domain/admin-teams"

export function TeamRow({ seasonId, row }: { seasonId: string; row: AdminTeamRow }) {
	return (
		<Link
			href={`/admin/seasons/${seasonId}/teams/${row.id}`}
			className="block min-h-11 px-4 py-3 hover:bg-z1/50 active:bg-z1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
		>
			<div className="flex items-baseline gap-2 font-cond">
				{row.rank !== null && <span className="w-5 shrink-0 text-xs text-muted">{row.rank}</span>}
				<span className="min-w-0 flex-1 truncate">{row.name}</span>
				<span className={`shrink-0 text-xs tabular-nums ${row.hintLoss ? "text-warn" : "text-muted"}`}>
					{row.hintLoss ? `−${row.hintLoss}p hints` : "no hints"}
				</span>
				<span className="w-12 shrink-0 text-right text-head font-bold tabular-nums">{row.score}p</span>
				<span aria-hidden="true" className="ml-1 shrink-0 text-muted">
					›
				</span>
			</div>
			<div className={`mt-1.5 ${row.rank !== null ? "pl-7" : ""}`}>
				<ArcRail rail={row.rail} size="small" />
			</div>
			{row.status.kind !== "before" && (
				<p className={`mt-1.5 truncate font-cond text-xs text-muted ${row.rank !== null ? "pl-7" : ""}`}>
					{row.status.kind === "finished" ? (
						"Finished every quest"
					) : (
						<>
							{row.status.kind === "on" ? "On " : "Stopped on "}
							<span className="text-ink">{row.status.quest}</span>
						</>
					)}
				</p>
			)}
		</Link>
	)
}

export function AddTeamForm({ seasonId }: { seasonId: string }) {
	const [name, setName] = useState("")
	const [password, setPassword] = useState("")
	const [state, action, pending] = useActionState<CreateTeamState, FormData>(async (previous, data) => {
		const result = await createTeamAction(seasonId, previous, data)
		if (result.ok) {
			setName("")
			setPassword("")
		}
		return result
	}, {})
	const id = useId()
	return (
		<form action={action} className="px-4 py-3">
			<div className="flex gap-2">
				<label htmlFor={`${id}-name`} className="sr-only">
					Team name
				</label>
				<input
					id={`${id}-name`}
					name="name"
					placeholder="Team name"
					value={name}
					onChange={(event) => setName(event.target.value)}
					disabled={pending}
					aria-invalid={!!state.error}
					aria-describedby={state.error ? `${id}-error` : undefined}
					className={`${inputClass} min-w-0 flex-1 text-sm disabled:opacity-60`}
				/>
				<label htmlFor={`${id}-password`} className="sr-only">
					Password
				</label>
				<input
					id={`${id}-password`}
					name="password"
					type="text"
					autoComplete="off"
					placeholder="Password"
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					disabled={pending}
					aria-invalid={!!state.error}
					aria-describedby={state.error ? `${id}-error` : undefined}
					className={`${inputClass.replace("w-full", "w-24")} min-w-0 shrink-0 text-sm disabled:opacity-60`}
				/>
				<button
					type="submit"
					disabled={pending}
					className="min-h-11 shrink-0 rounded-md bg-accent px-4 font-cond text-sm font-medium text-white hover:bg-accent/90 active:bg-accent/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
				>
					{pending ? "Adding…" : "Add"}
				</button>
			</div>
			{state.error && (
				<p id={`${id}-error`} role="alert" className="mt-2 font-cond text-sm text-warn">
					{state.error}
				</p>
			)}
		</form>
	)
}

export function TeamsList({ seasonId, rows }: { seasonId: string; rows: AdminTeamRow[] }) {
	return (
		<>
			<AddTeamForm seasonId={seasonId} />
			{rows.length ? (
				<ol className="divide-y divide-z1 border-y border-z1">
					{rows.map((row) => (
						<li key={row.id}>
							<TeamRow seasonId={seasonId} row={row} />
						</li>
					))}
				</ol>
			) : (
				<p className="px-4 py-3 font-cond text-sm text-muted">No teams yet.</p>
			)}
		</>
	)
}
