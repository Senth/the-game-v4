import { redirect } from "next/navigation"
import { QuestHeader } from "@/components/admin/quest-header"
import { QuestTitles } from "@/components/admin/quest-titles"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason } from "@/lib/db/seasons"
import { questLabel } from "@/lib/domain/season-tree"

export default async function QuestPage({ params }: PageProps<"/admin/seasons/[seasonId]/quests/[questId]">) {
	await requireAdmin()
	const { seasonId, questId } = await params
	const season = await getSeason(seasonId)
	const arc = season?.arcs.find((arc) => arc.quests.some((quest) => quest.id === questId))
	const quest = arc?.quests.find((quest) => quest.id === questId)
	if (!season || !arc || !quest) redirect(`/admin/seasons/${seasonId}`)
	const label = questLabel(quest)
	return (
		<>
			<QuestHeader seasonId={seasonId} arcTitle={arc.title} label={label} />
			<div className="px-4 py-5 lg:px-8 lg:py-6">
				<h2 className={`mb-6 hidden font-head text-2xl lg:block ${label ? "text-head" : "text-muted"}`}>
					{label ?? "Untitled quest"}
				</h2>
				<QuestTitles
					key={quest.id}
					seasonId={seasonId}
					arcId={arc.id}
					quest={{ id: quest.id, displayTitle: quest.displayTitle, internalTitle: quest.internalTitle }}
					start={season.start}
					end={season.end}
					now={Date.now()}
				/>
			</div>
		</>
	)
}
