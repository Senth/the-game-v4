import Link from "next/link"
import { formatSeasonStart, groupSeasons, seasonStatus } from "@/lib/domain/admin-seasons"
import type { Season } from "@/lib/domain/schemas"
import { SeasonStatus } from "./season-status"

export function SeasonList({ seasons, now }: { seasons: Season[]; now: number }) {
	const { current, past } = groupSeasons(seasons, new Date(now))
	if (!seasons.length) return <p className="px-4 py-5 font-cond text-sm text-muted">No seasons yet.</p>
	return (
		<div className="mx-auto max-w-2xl pb-10">
			{[
				{ title: "Now and next", seasons: current },
				{ title: "Past", seasons: past },
			].map(
				(group, index) =>
					group.seasons.length > 0 && (
						<section key={group.title} className={index === 0 ? "mt-5" : "mt-8"}>
							<h2 className="mb-1 px-4 font-cond text-xs uppercase tracking-wider text-muted">{group.title}</h2>
							<ul className="divide-y divide-z1 border-y border-z1">
								{group.seasons.map((season) => {
									const status = seasonStatus(season, new Date(now))
									return (
										<li key={season._id}>
											<Link
												href={`/admin/seasons/${season._id}`}
												className={`flex min-h-14 items-center gap-3 px-4 hover:bg-z1/50 active:bg-z1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${status === "ended" ? "text-muted" : "text-ink"}`}
											>
												<div className="min-w-0 flex-1">
													<p className="truncate text-sm">{season.title}</p>
													<p className="mt-0.5 font-cond text-xs text-muted">
														{season.start
															? `${status === "ended" ? "" : status === "upcoming" ? "Starts " : "Started "}${formatSeasonStart(season.start)}`
															: "No start time"}
													</p>
												</div>
												{status !== "ended" && <SeasonStatus status={status} end={season.end} now={now} />}
												<span aria-hidden="true" className="text-muted">
													›
												</span>
											</Link>
										</li>
									)
								})}
							</ul>
						</section>
					),
			)}
		</div>
	)
}
