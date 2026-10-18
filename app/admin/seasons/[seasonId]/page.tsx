import { notFound } from "next/navigation"
import { SeasonTree } from "@/components/admin/season-tree"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason } from "@/lib/db/seasons"
import { listSeasonTeams } from "@/lib/db/teams"
import { seasonStatus } from "@/lib/domain/admin-seasons"
import { questLiveStats } from "@/lib/domain/quest-stats"
import { treeView } from "@/lib/domain/season-tree"

export default async function SeasonPage({ params }: PageProps<"/admin/seasons/[seasonId]">) {
	await requireAdmin()
	const { seasonId } = await params
	const season = await getSeason(seasonId)
	if (!season) notFound()
	const now = Date.now()
	const liveStats =
		seasonStatus(season, new Date(now)) === "live" ? questLiveStats(season, await listSeasonTeams(seasonId)) : undefined
	const stats =
		liveStats &&
		Object.fromEntries(
			season.arcs.flatMap((arc) =>
				arc.quests.flatMap((quest) => {
					const stats = liveStats[quest.id]
					return stats ? [[quest.id, { ...stats, hints: quest.hints }]] : []
				}),
			),
		)
	return (
		<>
			<div className="lg:hidden">
				<SeasonTree
					seasonId={seasonId}
					seasonTitle={season.title}
					tree={treeView(season)}
					start={season.start}
					end={season.end}
					now={now}
					variant="page"
					stats={stats}
				/>
			</div>
			<div className="hidden h-full items-center justify-center px-4 lg:flex">
				<p className="font-cond text-sm text-muted">Pick a quest in the tree.</p>
			</div>
		</>
	)
}
