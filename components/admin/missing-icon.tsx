import { missingLabel } from "@/lib/domain/playable-quests"

export function MissingIcon({ missing }: { missing: readonly string[] }) {
	return (
		<svg
			viewBox="0 0 16 16"
			className="size-3.5 text-warn shrink-0"
			role="img"
			aria-label={`Missing ${missingLabel(missing)}`}
		>
			<path fill="currentColor" d="M8 1.2 15.2 14.6H.8z" />
			<path d="M8 6v3.8M8 11.9v.2" stroke="#05080d" strokeWidth="1.7" strokeLinecap="round" />
		</svg>
	)
}
