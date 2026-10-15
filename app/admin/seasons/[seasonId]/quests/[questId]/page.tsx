import { redirect } from "next/navigation"
import { HintsEditor } from "@/components/admin/hints-editor"
import { QuestEditor } from "@/components/admin/quest-editor"
import { QuestHeader } from "@/components/admin/quest-header"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason } from "@/lib/db/seasons"
import { listTeams } from "@/lib/db/teams"
import { hintRevealers } from "@/lib/domain/hints"
import { questLabel } from "@/lib/domain/season-tree"

export default async function QuestPage({ params }: PageProps<"/admin/seasons/[seasonId]/quests/[questId]">) {
	await requireAdmin()
	const { seasonId, questId } = await params
	const season = await getSeason(seasonId)
	const arc = season?.arcs.find((arc) => arc.quests.some((quest) => quest.id === questId))
	const quest = arc?.quests.find((quest) => quest.id === questId)
	if (!season || !arc || !quest) redirect(`/admin/seasons/${seasonId}`)
	const label = questLabel(quest)
	const revealers = hintRevealers(await listTeams(seasonId), questId)
	const now = Date.now()
	return (
		<>
			<QuestHeader seasonId={seasonId} arcTitle={arc.title} label={label} />
			<div className="px-4 py-5 lg:px-8 lg:py-6">
				<h2 className={`mb-6 hidden truncate font-head text-2xl lg:block ${label ? "text-head" : "text-muted"}`}>
					{label ?? "Untitled quest"}
				</h2>
				<QuestEditor
					key={quest.id}
					seasonId={seasonId}
					arcId={arc.id}
					quest={{
						id: quest.id,
						displayTitle: quest.displayTitle,
						internalTitle: quest.internalTitle,
						content: quest.content,
						assetPath: quest.assetPath,
						answers: quest.answers,
						points: quest.points,
						adminNotes: quest.adminNotes,
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
		</>
	)
}
