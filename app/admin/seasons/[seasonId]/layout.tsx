import Link from "next/link"
import { notFound } from "next/navigation"
import { AdminFrame } from "@/components/admin/admin-frame"
import { AutosaveProvider } from "@/components/admin/autosave-provider"
import { LiveControls } from "@/components/admin/live-controls"
import { AutosaveHeader, SaveStatus } from "@/components/admin/save-status"
import { SeasonMenu } from "@/components/admin/season-menu"
import { SeasonPhoneChrome } from "@/components/admin/season-phone-chrome"
import { SeasonPreview } from "@/components/admin/season-preview"
import { SeasonStatus } from "@/components/admin/season-status"
import { SeasonMenuLinks, SeasonTabs } from "@/components/admin/season-tabs"
import { SeasonTree } from "@/components/admin/season-tree"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason, listSeasons } from "@/lib/db/seasons"
import { listSeasonTeams } from "@/lib/db/teams"
import { liveControls, seasonStatus } from "@/lib/domain/admin-seasons"
import { questLiveStats } from "@/lib/domain/quest-stats"
import { treeView } from "@/lib/domain/season-tree"

export default async function SeasonLayout({ children, params }: LayoutProps<"/admin/seasons/[seasonId]">) {
	await requireAdmin()
	const { seasonId } = await params
	const season = await getSeason(seasonId)
	if (!season) notFound()
	const [seasons, teams] = await Promise.all([listSeasons(), listSeasonTeams(seasonId)])
	const teamCount = teams.length
	const now = Date.now()
	const liveControlState = liveControls(season, new Date(now))
	const liveStats = seasonStatus(season, new Date(now)) === "live" ? questLiveStats(season, teams) : undefined
	const stats =
		liveStats &&
		Object.fromEntries(
			season.arcs.flatMap((arc) =>
				arc.quests.flatMap((quest) => {
					const questStats = liveStats[quest.id]
					return questStats ? [[quest.id, { ...questStats, hints: quest.hints }]] : []
				}),
			),
		)
	const status = <SeasonStatus start={season.start} end={season.end} now={now} />
	const controls = (
		<LiveControls
			seasonId={seasonId}
			start={season.start}
			end={season.end}
			now={now}
			teamCount={teamCount}
			hasQuests={liveControlState.hasQuests}
			incomplete={liveControlState.incomplete}
		/>
	)
	return (
		<AutosaveProvider
			key={seasonId}
			seasonId={seasonId}
			start={season.start}
			end={season.end}
			now={now}
			finisherBonuses={season.finisherBonuses ?? []}
			finishers={season.finishers ?? []}
		>
			<AdminFrame
				title={season.title}
				status={status}
				controls={controls}
				menu={
					<SeasonMenu seasons={seasons} now={now} openSeasonId={seasonId}>
						<SeasonMenuLinks seasonId={seasonId} teamCount={teamCount} />
						<div className="mx-3 mt-2 border-t border-z1" />
						<SeasonTree
							seasonId={seasonId}
							seasonTitle={season.title}
							tree={treeView(season)}
							start={season.start}
							end={season.end}
							now={now}
							variant="menu"
							stats={stats}
						/>
					</SeasonMenu>
				}
				phoneHeader={
					<SeasonPhoneChrome>
						<AutosaveHeader className="flex min-h-12 items-center border-b px-1 font-cond">
							<Link
								href="/admin"
								className="flex min-h-11 shrink-0 items-center px-3 text-link hover:underline active:text-head focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
							>
								‹ Seasons
							</Link>
							<h1 className="min-w-0 flex-1 truncate pr-4 font-head text-head">{season.title}</h1>
							<div className="shrink-0 pr-3">
								<SaveStatus />
							</div>
						</AutosaveHeader>
						<div className="border-b border-z1 px-4 py-3">
							{status}
							<div className="mt-3">{controls}</div>
						</div>
						<SeasonTabs seasonId={seasonId} />
					</SeasonPhoneChrome>
				}
				preview={
					<SeasonPreview
						season={{
							start: season.start,
							end: season.end,
							lengthMinutes: season.lengthMinutes,
							arcs: season.arcs,
							finishers: season.finishers ?? [],
						}}
						teams={teams}
						now={now}
					/>
				}
			>
				{children}
			</AdminFrame>
		</AutosaveProvider>
	)
}
