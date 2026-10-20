"use client"

import { Fragment } from "react"
import { FinishFlag } from "@/components/finish-flag"
import { ordinal } from "@/lib/domain/game"
import { teamHistory } from "@/lib/domain/team-history"
import { useSeasonClock } from "./use-season-clock"

const paceColors = {
	"pace-ok": "text-pace-ok",
	"pace-1": "text-pace-1",
	"pace-2": "text-pace-2",
	"pace-3": "text-pace-3",
}

export function TeamHistory({
	season,
	team,
	now,
}: {
	season: Parameters<typeof teamHistory>[0]
	team: Parameters<typeof teamHistory>[1]
	now: number
}) {
	const clock = useSeasonClock(now, season.start, season.end)
	const history = teamHistory(season, team, new Date(clock))
	const { stats } = history
	const state = stats.state
	const stateLabel =
		state.kind === "running"
			? state.label
			: state.kind === "before"
				? "Not started"
				: state.kind === "ended"
					? "Game ended"
					: "Finished"
	const stateColor =
		state.kind === "running" ? paceColors[state.band] : state.kind === "finished" ? "text-pace-ok" : "text-muted"
	const groups = [
		...history.arcs.map((arc) => ({ ...arc, id: `arc-${arc.id}`, removed: false })),
		...(history.bonus
			? [
					{
						id: "bonus",
						title: "Finisher bonus",
						removed: false,
						quests: [
							{
								id: "bonus",
								label: `Finished ${ordinal(history.bonus.place)}`,
								status: "bonus" as const,
								pointsEarned: history.bonus.points,
								hints: [],
							},
						],
					},
				]
			: []),
		...(history.removed.length
			? [
					{
						id: "removed",
						title: "Removed during play",
						removed: true,
						quests: history.removed.map((quest) => ({
							id: quest.questId,
							label: "Removed quest",
							status: quest.solved ? ("solved" as const) : ("skipped" as const),
							pointsEarned: quest.pointsEarned,
							hints: quest.hints,
						})),
					},
				]
			: []),
	]
	return (
		<>
			<section aria-label="Team stats" className="flex items-end justify-between gap-3 border-b border-z1 px-4 py-4">
				<div>
					<p className="font-cond uppercase tracking-wider text-xs text-muted">Score</p>
					<p className="font-cond text-4xl text-head font-bold tabular-nums">{stats.score}p</p>
				</div>
				<div className="text-right font-cond text-sm space-y-0.5">
					<p>
						<span className="text-head tabular-nums">
							{stats.solved} / {stats.total}
						</span>{" "}
						<span className="text-muted">solved</span>
					</p>
					<p className={stats.hintLoss ? "text-warn tabular-nums" : "text-muted"}>
						{stats.hintLoss ? `−${stats.hintLoss}p from hints` : "No hints"}
					</p>
					<p className={stateColor}>{stateLabel}</p>
				</div>
			</section>
			{groups.map((group) => (
				<section key={group.id}>
					<h3
						className={`px-4 mt-5 mb-1 font-cond uppercase tracking-wider text-xs ${group.removed ? "text-muted" : "text-ink"}`}
					>
						{group.title}
					</h3>
					<ol>
						{group.quests.map((quest, index) => (
							<li
								key={quest.id}
								className={`grid grid-cols-[1rem_minmax(0,1fr)_auto] gap-x-3 px-4 py-3 ${quest.status === "current" ? "bg-accent/10" : group.quests[index + 1]?.status === "current" ? "" : "border-b border-z1 last:border-0"}`}
							>
								<span className="flex justify-center items-center h-6">
									{quest.status === "bonus" ? (
										<FinishFlag points={quest.pointsEarned} />
									) : quest.status === "solved" ? (
										<span role="img" className="text-pace-ok" aria-label="Solved">
											✓
										</span>
									) : quest.status === "current" ? (
										<span
											role="img"
											className="h-2.5 w-2.5 rounded-full bg-accent ring-4 ring-accent/25"
											aria-label="Current"
										/>
									) : quest.status === "stopped" ? (
										<span role="img" className="h-2.5 w-2.5 rounded-full border-2 border-muted" aria-label="Stopped" />
									) : quest.status === "skipped" ? (
										<span role="img" className="text-muted" aria-label="Skipped">
											×
										</span>
									) : (
										<span role="img" className="h-2 w-2 rounded-full bg-z2" aria-label="Not reached" />
									)}
								</span>
								<span
									className={`text-sm truncate leading-6 ${group.removed || !quest.label || quest.status === "todo" || quest.status === "stopped" ? "text-muted" : quest.status === "current" ? "text-head" : "text-ink"}`}
								>
									{quest.label ?? "Untitled quest"}
								</span>
								<span className="font-cond text-sm text-right tabular-nums leading-6 whitespace-nowrap">
									{quest.status === "solved" || quest.status === "bonus" ? (
										<span className={`${quest.status === "bonus" ? "text-pace-ok" : "text-head"} font-bold`}>
											{quest.pointsEarned >= 0 ? "+" : ""}
											{quest.pointsEarned}p
										</span>
									) : quest.status === "current" ? (
										<span className="text-link">Now</span>
									) : quest.status === "stopped" ? (
										<span className="text-muted">Stopped</span>
									) : quest.status === "skipped" ? (
										<span className="text-muted">Skipped · 0p</span>
									) : null}
								</span>
								{quest.hints.map((hint) => (
									<Fragment key={hint.hintId}>
										<span aria-hidden="true" />
										<span className="flex gap-2 text-xs leading-5 min-w-0">
											<span className="font-cond text-muted shrink-0">{hint.label}</span>
											<span className="text-ink/80 truncate">{hint.text}</span>
										</span>
										<span className="font-cond text-xs text-warn text-right tabular-nums leading-5 whitespace-nowrap">
											−{hint.points}p
										</span>
									</Fragment>
								))}
							</li>
						))}
					</ol>
				</section>
			))}
		</>
	)
}
