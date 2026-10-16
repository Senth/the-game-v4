"use client"

import Link from "next/link"
import { type ReactNode, useEffect, useState } from "react"
import { LogOutButton } from "@/components/log-out-button"
import type { PlayerGame } from "@/lib/domain/player-game"
import { lifecycleView } from "./lifecycle"

export function LifecycleScreen({
	game,
	now,
	qr,
	preview = false,
}: {
	game: Exclude<PlayerGame, { lifecycleState: "running" }>
	now: Date
	qr?: ReactNode
	preview?: boolean
}) {
	const [mounted, setMounted] = useState(false)
	useEffect(() => setMounted(true), [])
	const view = lifecycleView(game, now)
	const value = view.value
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
				{!preview && qr && (game.lifecycleState === "waiting" || game.lifecycleState === "countdown") && (
					<div className="mt-12">{qr}</div>
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
