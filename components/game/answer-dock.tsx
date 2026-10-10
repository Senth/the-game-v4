"use client"

import { useEffect, useRef } from "react"

export type AnswerFeedback =
	| { id: number; kind: "wrong"; answer: string }
	| { id: number; kind: "correct"; points: number | null }
	| { id: number; kind: "error"; message: string }

export function AnswerDock({
	answer,
	onAnswerChange,
	onSubmit,
	pending,
	feedback,
}: {
	answer: string
	onAnswerChange: (answer: string) => void
	onSubmit: (answer: string) => void
	pending: boolean
	feedback: AnswerFeedback | null
}) {
	const input = useRef<HTMLInputElement>(null)
	useEffect(() => {
		if (feedback?.kind === "wrong") input.current?.select()
	}, [feedback])
	const warning = feedback?.kind !== "correct"
	return (
		<div className="fixed inset-x-0 bottom-0 z-20 border-t border-z2 bg-z1">
			<div className="mx-auto max-w-2xl">
				<p aria-live="polite" aria-atomic="true" className="-mb-1 h-7 px-4 pt-2 font-cond text-sm">
					{feedback && (
						<span
							key={feedback.id}
							className={`flex min-w-0 animate-[answer-feedback_4s_linear_forwards] ${warning ? "text-warn" : "text-pace-ok"}`}
						>
							{feedback.kind === "wrong" ? (
								<>
									<span className="shrink-0">{'"'}</span>
									<span className="min-w-0 truncate">{feedback.answer}</span>
									<span className="shrink-0">{'" is not it.'}</span>
								</>
							) : feedback.kind === "error" ? (
								feedback.message
							) : (
								`Solved.${feedback.points === null ? "" : ` ${feedback.points >= 0 ? "+" : ""}${feedback.points}p`}`
							)}
						</span>
					)}
				</p>
				<form
					className="flex gap-2 px-4 pt-2 pb-[calc(var(--spacing)*6+env(safe-area-inset-bottom))]"
					onSubmit={(event) => {
						event.preventDefault()
						if (!pending && answer.trim()) onSubmit(answer)
					}}
				>
					<div className="relative min-w-0 flex-1">
						<input
							ref={input}
							aria-label="Your answer"
							name="answer"
							value={answer}
							onChange={(event) => onAnswerChange(event.target.value)}
							maxLength={200}
							placeholder="Your answer"
							autoComplete="off"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
							className="h-12 w-full rounded-md border border-link/40 bg-field px-3 text-ink focus-visible:outline-2 focus-visible:outline-accent"
						/>
						{feedback && (
							<span
								key={feedback.id}
								aria-hidden="true"
								className={`pointer-events-none absolute inset-0 animate-[answer-feedback_4s_linear_forwards] rounded-md border ring-2 ${warning ? "border-warn ring-warn/40" : "border-pace-ok ring-pace-ok/40"}`}
							/>
						)}
					</div>
					<button
						type="submit"
						disabled={pending || !answer.trim()}
						aria-busy={pending}
						className="h-12 shrink-0 rounded-md bg-accent px-5 font-cond font-bold text-white hover:bg-accent/80 focus-visible:outline-2 focus-visible:outline-link active:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
					>
						Send
					</button>
				</form>
			</div>
		</div>
	)
}
