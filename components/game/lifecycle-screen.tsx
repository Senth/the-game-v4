"use client"

import Link from "next/link"
import { type FormEvent, type ReactNode, useEffect, useState } from "react"
import { FinishFlag } from "@/components/finish-flag"
import { LogOutButton } from "@/components/log-out-button"
import { ordinal } from "@/lib/domain/game"
import type { PlayerGame } from "@/lib/domain/player-game"
import { lifecycleView } from "./lifecycle"
import type { SavePhoneName } from "./name-dialog"

export function LifecycleScreen({
	game,
	now,
	qr,
	preview = false,
	savePhoneName,
}: {
	game: Exclude<PlayerGame, { lifecycleState: "running" }>
	now: Date
	qr?: ReactNode
	preview?: boolean
	savePhoneName?: SavePhoneName
}) {
	const [mounted, setMounted] = useState(false)
	useEffect(() => setMounted(true), [])
	const currentPhoneName =
		game.lifecycleState === "waiting" || game.lifecycleState === "countdown"
			? (game.phones.find((phone) => phone.you)?.name ?? "")
			: ""
	const [name, setName] = useState(currentPhoneName)
	const [dirty, setDirty] = useState(false)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<"taken" | "invalid" | "failed" | null>(null)
	useEffect(() => {
		if (!dirty) setName(currentPhoneName)
	}, [currentPhoneName, dirty])
	async function saveName(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (!savePhoneName || saving) return
		setSaving(true)
		setError(null)
		try {
			const result = await savePhoneName(name)
			if ("error" in result) {
				setError(result.error)
				return
			}
			setName(result.phones.find((phone) => phone.you)?.name ?? name)
			setDirty(false)
		} catch {
			setError("failed")
		} finally {
			setSaving(false)
		}
	}
	const view = lifecycleView(game, now)
	const value = view.value
	const finisher =
		game.lifecycleState === "completed"
			? game.finishers.find((entry) => entry.teamId === game.teamId && entry.points > 0)
			: null
	let text = value?.text
	if (mounted && value?.kind === "countdown" && value.band !== "under-24-hours") {
		text = value.date.toLocaleString(undefined, {
			weekday: "short",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
			...(value.band === "7-days-or-more" ? { day: "numeric", month: "short" } : {}),
		})
	}
	return (
		<main className={`flex ${preview ? "h-full" : "min-h-dvh"} flex-col px-4`}>
			<div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
				<div className="text-center">
					<h1 className="font-head text-2xl font-medium text-head text-balance">{view.sentence}</h1>
					{value && (
						<p className="mt-3 min-h-18 font-cond text-7xl font-bold text-ink tabular-nums text-balance">{text}</p>
					)}
					{view.helper && <p className="mt-3 font-cond text-sm text-muted">{view.helper}</p>}
					{finisher && (
						<p className="mt-3 flex items-center justify-center gap-1 font-cond text-sm text-pace-ok">
							<FinishFlag points={finisher.points} />
							{finisher.place === 1 ? "First" : ordinal(finisher.place)} to finish · +{finisher.points}p
						</p>
					)}
					{value?.kind === "score" && (
						<>
							<p className="mt-3 font-cond text-3xl font-bold text-head">
								{value.place} <span className="text-lg font-medium text-muted">of {value.teamCount}</span>
							</p>
							{preview ? (
								<span className="mt-3 inline-flex h-11 items-center px-3 font-cond text-link">Standings ›</span>
							) : (
								<Link
									href="/standings"
									className="mt-3 inline-flex h-11 items-center px-3 font-cond text-link hover:underline active:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
								>
									Standings ›
								</Link>
							)}
						</>
					)}
				</div>
				{!preview && (game.lifecycleState === "waiting" || game.lifecycleState === "countdown") && (
					<section className="mt-10">
						<form onSubmit={saveName}>
							<label htmlFor="lifecycle-name" className="mb-1.5 block font-cond text-sm text-ink">
								Your name
							</label>
							<div className="flex gap-2">
								<input
									id="lifecycle-name"
									type="text"
									value={name}
									autoComplete="off"
									onChange={(event) => {
										setName(event.currentTarget.value)
										setDirty(true)
										setError(null)
									}}
									className="h-12 min-w-0 flex-1 rounded-md border border-link/40 bg-field px-3 font-body text-base text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
								/>
								<button
									type="submit"
									disabled={saving || !savePhoneName}
									className="h-12 rounded-md border border-z2 px-4 font-cond text-link hover:bg-z1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:bg-z2 disabled:opacity-50"
								>
									Save
								</button>
							</div>
						</form>
						<p className="mt-1.5 font-cond text-xs text-muted">Only {game.teamName} and the game masters see it.</p>
						{error && (
							<p role="alert" className="mt-1.5 font-cond text-xs text-warn">
								{error === "taken"
									? `Someone on ${game.teamName} already uses that name.`
									: error === "invalid"
										? "Name must be 1–20 characters."
										: "Could not save your name. Try again."}
							</p>
						)}
						<p className="mt-4 font-cond text-xs uppercase tracking-wider text-muted">On this team</p>
						<p className="mt-1 font-cond text-sm text-ink">
							{game.phones.map((phone, index) => (
								<span key={phone.name}>
									{index > 0 && " · "}
									{phone.name}
									{phone.you && <span className="text-muted"> (you)</span>}
								</span>
							))}
						</p>
					</section>
				)}
				{!preview && qr && (game.lifecycleState === "waiting" || game.lifecycleState === "countdown") && (
					<div className="mt-10">{qr}</div>
				)}
			</div>
			{!preview && (
				<footer className="pb-4 text-center text-sm">
					<LogOutButton />
				</footer>
			)}
		</main>
	)
}
