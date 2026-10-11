import type { RailArc } from "@/lib/domain/game"

const segmentColors = {
	solved: "bg-pace-ok",
	current: "bg-accent ring-2 ring-accent/40",
	todo: "bg-z2/60",
}

export function ArcRail({ rail, size = "default" }: { rail: RailArc[]; size?: "default" | "small" | "tv" }) {
	return (
		<div className={`flex ${size === "tv" ? "gap-5" : "gap-2.5"}`}>
			{rail
				.filter((arc) => arc.segments.length > 0)
				.map((arc) => (
					<div
						key={arc.arcId}
						className={`flex min-w-0 ${size === "tv" ? "gap-1.5" : "gap-[3px]"}`}
						style={{ flex: arc.segments.length }}
					>
						{arc.segments.map((segment) => (
							<span
								key={segment.questId}
								role="img"
								aria-label={segment.state === "todo" ? "Unsolved quest" : `${segment.state} quest`}
								aria-current={segment.state === "current" ? "step" : undefined}
								className={`${size === "tv" ? "h-4" : size === "small" ? "h-1.5" : "h-2"} flex-1 rounded-sm ${segmentColors[segment.state]}`}
							/>
						))}
					</div>
				))}
		</div>
	)
}
