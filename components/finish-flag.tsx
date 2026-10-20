export function FinishFlag({ points = 0, className = "h-4 w-4" }: { points?: number; className?: string }) {
	return (
		<svg
			aria-label={points > 0 ? `Finished, +${points}p bonus` : "Finished"}
			role="img"
			viewBox="0 0 20 20"
			fill="none"
			className={`shrink-0 text-pace-ok ${className}`}
		>
			<path d="M4 17V3m0 0h11l-3 4 3 4H4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
		</svg>
	)
}
