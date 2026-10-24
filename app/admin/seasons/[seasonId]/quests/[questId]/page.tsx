import { redirect } from "next/navigation"
import { HintsEditor } from "@/components/admin/hints-editor"
import { QuestEditor } from "@/components/admin/quest-editor"
import { QuestHeader } from "@/components/admin/quest-header"
import { QuestLiveStatsBlock } from "@/components/admin/quest-live-stats"
import { QuestPreview } from "@/components/admin/quest-preview"
import { QuestViewToggle } from "@/components/admin/quest-view-toggle"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason } from "@/lib/db/seasons"
import { listSeasonTeams } from "@/lib/db/teams"
import { seasonStatus } from "@/lib/domain/admin-seasons"
import { hintRevealers } from "@/lib/domain/hints"
import { defaultPlaceRadius } from "@/lib/domain/location"
import { puzzleLocked } from "@/lib/domain/puzzle"
import { questLiveStats } from "@/lib/domain/quest-stats"
import { questLabel } from "@/lib/domain/season-tree"

export default async function QuestPage({ params }: PageProps<"/admin/seasons/[seasonId]/quests/[questId]">) {
	await requireAdmin()
	const { seasonId, questId } = await params
	const season = await getSeason(seasonId)
	const arc = season?.arcs.find((arc) => arc.quests.some((quest) => quest.id === questId))
	const quest = arc?.quests.find((quest) => quest.id === questId)
	if (!season || !arc || !quest) redirect(`/admin/seasons/${seasonId}`)
	const label = questLabel(quest)
	const teams = await listSeasonTeams(seasonId)
	const solvedTeams = teams.filter((team) =>
		team.progress.some((progress) => progress.questId === quest.id && progress.solvedAt),
	).length
	const now = Date.now()
	const revealers = hintRevealers(teams, questId)
	const stats = seasonStatus(season, new Date(now)) === "live" ? questLiveStats(season, teams)[questId] : null
	return (
		<>
			<QuestHeader seasonId={seasonId} arcTitle={arc.title} label={label} />
			<QuestViewToggle
				key={quest.id}
				preview={
					<QuestPreview
						season={{
							start: season.start,
							end: season.end,
							lengthMinutes: season.lengthMinutes,
							arcs: season.arcs,
						}}
						arcId={arc.id}
						quest={quest}
						now={now}
					/>
				}
			>
				<div className="px-4 py-5 lg:px-8 lg:py-6">
					<h2 className={`mb-6 hidden truncate font-head text-2xl lg:block ${label ? "text-head" : "text-muted"}`}>
						{label ?? "Untitled quest"}
					</h2>
					{stats && (
						<div className="hidden lg:block">
							<QuestLiveStatsBlock stats={stats} hints={quest.hints} variant="desktop" />
						</div>
					)}
					<QuestEditor
						seasonId={seasonId}
						seasonTitle={season.title}
						arcId={arc.id}
						arcTitle={arc.title}
						hintCount={quest.hints.length}
						reachedTeams={puzzleLocked(season, teams, quest.id)}
						solvedTeams={solvedTeams}
						placeRadius={season.placeRadius ?? defaultPlaceRadius}
						mapArea={season.mapArea ?? null}
						quest={{
							id: quest.id,
							displayTitle: quest.displayTitle,
							internalTitle: quest.internalTitle,
							content: quest.content,
							assetPath: quest.assetPath,
							answers: quest.answers,
							points: quest.points,
							puzzle: quest.puzzle,
							location: quest.location,
							adminNotes: quest.adminNotes,
							...(quest.hidden ? { hidden: true } : {}),
						}}
						start={season.start}
						end={season.end}
						now={now}
					>
						<HintsEditor
							arcId={arc.id}
							questId={quest.id}
							points={quest.points}
							hints={quest.hints}
							revealers={revealers}
							start={season.start}
							end={season.end}
							now={now}
						/>
					</QuestEditor>
				</div>
			</QuestViewToggle>
		</>
	)
}
