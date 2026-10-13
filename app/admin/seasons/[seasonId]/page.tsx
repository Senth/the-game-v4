import { notFound } from "next/navigation"
import { SeasonTree } from "@/components/admin/season-tree"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason } from "@/lib/db/seasons"
import { treeView } from "@/lib/domain/season-tree"

export default async function SeasonPage({ params }: PageProps<"/admin/seasons/[seasonId]">) {
	await requireAdmin()
	const { seasonId } = await params
	const season = await getSeason(seasonId)
	if (!season) notFound()
	return (
		<>
			<div className="lg:hidden">
				<SeasonTree
					seasonId={seasonId}
					tree={treeView(season)}
					start={season.start}
					end={season.end}
					now={Date.now()}
					variant="page"
				/>
			</div>
			<div className="hidden h-full items-center justify-center px-4 lg:flex">
				<p className="font-cond text-sm text-muted">Pick a quest in the tree.</p>
			</div>
		</>
	)
}
