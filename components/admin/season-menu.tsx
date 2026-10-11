import Link from "next/link"
import type { ReactNode } from "react"
import { formatSeasonDay, formatSeasonMonth, groupSeasons, seasonStatus } from "@/lib/domain/admin-seasons"
import type { Season } from "@/lib/domain/schemas"
import { NewSeasonForm } from "./new-season-form"

export function SeasonMenu({
	seasons,
	now,
	openSeasonId,
	children,
}: {
	seasons: Season[]
	now: number
	openSeasonId?: string
	children?: ReactNode
}) {
	const { current, past } = groupSeasons(seasons, new Date(now))
	return (
		<nav aria-label="Seasons" className="py-2 font-cond">
			<NewSeasonForm variant="menu" />
			{!seasons.length && <p className="px-4 py-2 text-sm text-muted">No seasons yet.</p>}
			{[
				{ title: "Now and next", seasons: current },
				{ title: "Past", seasons: past },
			].map(
				(group, index) =>
					group.seasons.length > 0 && (
						<section key={group.title}>
							<h2 className={`mb-1 px-4 text-xs uppercase tracking-wider text-muted ${index === 0 ? "mt-2" : "mt-4"}`}>
								{group.title}
							</h2>
							<ul>
								{group.seasons.map((season) => {
									const status = seasonStatus(season, new Date(now))
									const open = season._id === openSeasonId
									return (
										<li key={season._id}>
											<Link
												href={`/admin/seasons/${season._id}`}
												aria-current={open ? "page" : undefined}
												className={`flex min-h-11 items-center justify-between gap-2 px-4 text-sm hover:bg-z1/50 active:bg-z1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${open ? "font-medium text-head" : status === "ended" ? "text-muted" : "text-ink"}`}
											>
												<span className="min-w-0 truncate">
													<span aria-hidden="true">{open ? "▾" : "▸"} </span>
													{season.title}
												</span>
												<span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted">
													{status === "live" ? (
														<>
															<span aria-hidden="true" className="size-1.5 rounded-full bg-pace-ok" />
															Live
														</>
													) : season.start ? (
														status === "ended" ? (
															formatSeasonMonth(season.start)
														) : (
															formatSeasonDay(season.start)
														)
													) : (
														"Not started"
													)}
												</span>
											</Link>
											{open && <div className="ml-3 border-l border-z1">{children}</div>}
										</li>
									)
								})}
							</ul>
						</section>
					),
			)}
		</nav>
	)
}
