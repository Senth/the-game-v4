import type { RailArc } from "@/lib/domain/game"

const segmentColors = {
	solved: "bg-pace-ok",
	current: "bg-accent ring-2 ring-accent/40",
	todo: "bg-z2/60",
}

export function ArcRail({ rail }: { rail: RailArc[] }) {
	return (
		<div className="flex gap-2.5">
			{rail
				.filter((arc) => arc.segments.length > 0)
				.map((arc) => (
					<div key={arc.arcId} className="flex min-w-0 gap-[3px]" style={{ flex: arc.segments.length }}>
						{arc.segments.map((segment) => (
							<span
								key={segment.questId}
								role="img"
								aria-label={segment.state === "todo" ? "Unsolved quest" : `${segment.state} quest`}
								aria-current={segment.state === "current" ? "step" : undefined}
								className={`h-2 flex-1 rounded-sm ${segmentColors[segment.state]}`}
							/>
						))}
					</div>
				))}
		</div>
	)
}
