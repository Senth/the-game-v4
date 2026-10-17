import { labelClass } from "@/components/auth-form"
import type { StructuralEditImpact } from "@/lib/domain/game"

type DeleteImpact = Extract<StructuralEditImpact, { kind: "deleteQuest" }>

export function RemovalImpact({
	impact,
	onItLabel,
	notReachedLabel,
	solvedLabel,
}: {
	impact: DeleteImpact
	onItLabel: string
	notReachedLabel: string
	solvedLabel: (count: number) => string
}) {
	const affected = impact.onIt.length + impact.notReached.length
	return (
		<div>
			<p className="font-cond text-sm text-head">
				{affected === 0 ? "No team is affected" : `${affected} team${affected === 1 ? "" : "s"} affected`}
			</p>
			{impact.onIt.length > 0 && (
				<div className="mt-3">
					<p className={labelClass}>{onItLabel}</p>
					<ul className="flex flex-wrap gap-1">
						{impact.onIt.map((name) => (
							<li
								key={name}
								className="inline-flex min-h-6 items-center rounded bg-warn/15 px-2 font-cond text-xs text-warn"
							>
								{name}
							</li>
						))}
					</ul>
				</div>
			)}
			{impact.notReached.length > 0 && (
				<div className="mt-3">
					<p className={labelClass}>{notReachedLabel}</p>
					<ul className="flex flex-wrap gap-1">
						{impact.notReached.map((name) => (
							<li key={name} className="inline-flex min-h-6 items-center rounded bg-z2 px-2 font-cond text-xs">
								{name}
							</li>
						))}
					</ul>
				</div>
			)}
			{impact.solved > 0 && <p className="mt-3 font-cond text-xs text-muted">{solvedLabel(impact.solved)}</p>}
		</div>
	)
}
