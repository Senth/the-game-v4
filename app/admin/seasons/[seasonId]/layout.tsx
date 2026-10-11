import Link from "next/link"
import { notFound } from "next/navigation"
import { AdminFrame } from "@/components/admin/admin-frame"
import { SeasonMenu } from "@/components/admin/season-menu"
import { SeasonStatus } from "@/components/admin/season-status"
import { SeasonMenuLinks, SeasonTabs } from "@/components/admin/season-tabs"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason, listSeasons } from "@/lib/db/seasons"
import { countTeams } from "@/lib/db/teams"
import { seasonStatus } from "@/lib/domain/admin-seasons"

export default async function SeasonLayout({ children, params }: LayoutProps<"/admin/seasons/[seasonId]">) {
	await requireAdmin()
	const { seasonId } = await params
	const season = await getSeason(seasonId)
	if (!season) notFound()
	const [seasons, teamCount] = await Promise.all([listSeasons(), countTeams(seasonId)])
	const now = Date.now()
	const status = <SeasonStatus status={seasonStatus(season, new Date(now))} end={season.end} now={now} />
	return (
		<AdminFrame
			title={season.title}
			status={status}
			menu={
				<SeasonMenu seasons={seasons} now={now} openSeasonId={seasonId}>
					<SeasonMenuLinks seasonId={seasonId} teamCount={teamCount} />
				</SeasonMenu>
			}
			phoneHeader={
				<>
					<header className="flex min-h-12 items-center border-b border-z1 px-1 font-cond">
						<Link
							href="/admin"
							className="flex min-h-11 shrink-0 items-center px-3 text-link hover:underline active:text-head focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
						>
							‹ Seasons
						</Link>
						<h1 className="min-w-0 truncate pr-4 font-head text-head">{season.title}</h1>
					</header>
					<div className="border-b border-z1 px-4 py-3">{status}</div>
					<SeasonTabs seasonId={seasonId} />
				</>
			}
			preview={
				<>
					<h2 className="font-cond text-xs uppercase tracking-wider text-muted">Player preview</h2>
					<p className="mt-3 font-cond text-sm text-muted">Open a quest or team to preview it.</p>
				</>
			}
		>
			{children}
		</AdminFrame>
	)
}
