"use client"

import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "@/components/use-reduced-motion"
import type { PlayerHint, PlayerQuest } from "@/lib/domain/game"
import { createHold } from "./hold"
import { scrambleFrame } from "./scramble"

const hintNumber = (position: number) => String(position).padStart(2, "0")

function LockedHint({
	hint,
	reducedMotion,
	onReveal,
	preview = false,
}: {
	hint: Extract<PlayerHint, { revealed: false }>
	reducedMotion: boolean
	onReveal?: (hintId: string) => Promise<void>
	preview?: boolean
}) {
	const hold = useRef<ReturnType<typeof createHold> | null>(null)
	const [progress, setProgress] = useState(0)
	const [holding, setHolding] = useState(false)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState(false)

	useEffect(
		() => () => {
			const current = hold.current
			hold.current = null
			current?.release()
		},
		[],
	)

	function press() {
		if (pending || hold.current || !onReveal) return
		setHolding(true)
		setError(false)
		hold.current = createHold({
			durationMs: 2000,
			onProgress: setProgress,
			onComplete: async () => {
				if (!hold.current) return
				hold.current = null
				setHolding(false)
				setProgress(0)
				setPending(true)
				try {
					if (!onReveal) return
					await onReveal(hint.id)
				} catch {
					setError(true)
				} finally {
					setPending(false)
				}
			},
		})
		hold.current.press()
	}

	function release() {
		hold.current?.release()
		hold.current = null
		setHolding(false)
	}
	const rowClass = "flex min-h-11 w-full items-center justify-between gap-3 text-left font-cond text-sm"
	const label = (
		<span className="relative">
			<span className="mr-2 text-muted">{hintNumber(hint.position)}</span>
			<span className={holding || pending ? "text-head" : error ? "text-warn" : "text-link"}>
				{holding
					? `Decrypting… ${((1 - progress) * 2).toFixed(1)} s`
					: pending
						? "Decrypting…"
						: error
							? "Could not decrypt. Hold to retry."
							: "Hold to decrypt"}
			</span>
		</span>
	)
	const penalty = (
		<span className={`relative shrink-0 tabular-nums ${holding || pending ? "text-warn" : "text-muted"}`}>
			−{hint.points}p
		</span>
	)
	if (preview)
		return (
			<div className={`${rowClass} select-none`}>
				{label}
				{penalty}
			</div>
		)

	return (
		<button
			type="button"
			disabled={pending}
			aria-busy={pending}
			className={`relative ${rowClass} touch-none select-none overflow-hidden hover:bg-link/5 focus-visible:outline-2 focus-visible:outline-link focus-visible:-outline-offset-2 active:bg-link/10 disabled:cursor-wait`}
			onPointerDown={(event) => {
				if (event.button !== 0 || !event.isPrimary) return
				event.currentTarget.setPointerCapture(event.pointerId)
				press()
			}}
			onPointerUp={release}
			onPointerCancel={release}
			onLostPointerCapture={release}
			onBlur={release}
			onContextMenu={(event) => event.preventDefault()}
			onKeyDown={(event) => {
				if (event.key !== " " && event.key !== "Enter") return
				event.preventDefault()
				if (!event.repeat) press()
			}}
			onKeyUp={(event) => {
				if (event.key !== " " && event.key !== "Enter") return
				event.preventDefault()
				release()
			}}
		>
			<span
				aria-hidden="true"
				className={`absolute inset-y-0 left-0 bg-link/15 ${holding ? "" : "transition-[width] duration-200 ease-out"} motion-reduce:transition-none`}
				style={{ width: reducedMotion ? "0%" : `${progress * 100}%` }}
			/>
			{label}
			{penalty}
		</button>
	)
}

function RevealedHint({
	hint,
	decrypting,
	reducedMotion,
	onComplete,
}: {
	hint: Extract<PlayerHint, { revealed: true }>
	decrypting: boolean
	reducedMotion: boolean
	onComplete?: (hintId: string) => void
}) {
	const [frame, setFrame] = useState(() =>
		decrypting && !reducedMotion ? scrambleFrame(hint.text, 0, Math.random) : hint.text,
	)
	useEffect(() => {
		if (!decrypting) return
		if (reducedMotion) {
			onComplete?.(hint.id)
			return
		}
		const start = performance.now()
		let animationFrame = 0
		let timer: ReturnType<typeof setTimeout> | undefined
		function step(now: number) {
			const progress = Math.min((now - start) / 3500, 1)
			setFrame(scrambleFrame(hint.text, progress, Math.random))
			if (progress < 1)
				timer = setTimeout(() => {
					animationFrame = requestAnimationFrame(step)
				}, 45)
			else onComplete?.(hint.id)
		}
		setFrame(scrambleFrame(hint.text, 0, Math.random))
		animationFrame = requestAnimationFrame(step)
		return () => {
			cancelAnimationFrame(animationFrame)
			clearTimeout(timer)
		}
	}, [hint.id, hint.text, decrypting, reducedMotion, onComplete])

	return (
		<div className="flex items-start justify-between gap-3 py-2.5 text-sm">
			<span>
				<span className="mr-2 font-cond text-muted">{hintNumber(hint.position)}</span>
				{decrypting && !reducedMotion ? (
					<>
						<span aria-hidden="true">{frame}</span>
						<span className="sr-only">{hint.text}</span>
					</>
				) : (
					hint.text
				)}
			</span>
			<span className="shrink-0 font-cond tabular-nums text-warn">−{hint.points}p</span>
		</div>
	)
}

type IntelProps =
	| {
			quest: Pick<PlayerQuest, "worth" | "points" | "hints">
			preview: true | "team"
	  }
	| {
			quest: Pick<PlayerQuest, "worth" | "points" | "hints">
			preview?: false
			onReveal: (hintId: string) => Promise<void>
			decrypting: ReadonlySet<string>
			onDecryptComplete: (hintId: string) => void
	  }

export function Intel({ quest, ...props }: IntelProps) {
	const reducedMotion = useReducedMotion()
	const live = props.preview ? null : props

	return (
		<section className="mt-7" aria-label="Intel">
			<div className="flex items-end justify-between border-b border-z2 pb-2">
				<span className="font-cond text-xs uppercase tracking-wider text-muted">Intel</span>
				<span className="font-cond">
					<span className="text-3xl font-bold tabular-nums text-head">{quest.worth}p</span>
					<span className="text-sm text-muted"> / {quest.points ?? 0}p</span>
				</span>
			</div>
			<ul>
				{quest.hints.map((hint) => (
					<li key={hint.id} className="border-b border-z1 last:border-b-0">
						{hint.revealed && (live || props.preview === "team") ? (
							<RevealedHint
								hint={hint}
								decrypting={live?.decrypting.has(hint.id) ?? false}
								reducedMotion={reducedMotion}
								onComplete={live?.onDecryptComplete}
							/>
						) : (
							<LockedHint
								hint={{ id: hint.id, position: hint.position, points: hint.points, revealed: false }}
								reducedMotion={reducedMotion}
								preview={!live}
								onReveal={live?.onReveal}
							/>
						)}
					</li>
				))}
			</ul>
		</section>
	)
}
