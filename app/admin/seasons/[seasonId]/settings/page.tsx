import { notFound } from "next/navigation"
import { SeasonSettings } from "@/components/admin/season-settings"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason } from "@/lib/db/seasons"
import { listSeasonTeams } from "@/lib/db/teams"
import { defaultPlaceRadius } from "@/lib/domain/location"

export default async function SettingsPage({ params }: PageProps<"/admin/seasons/[seasonId]/settings">) {
	await requireAdmin()
	const { seasonId } = await params
	const season = await getSeason(seasonId)
	if (!season) notFound()
	const teams = await listSeasonTeams(seasonId)
	return (
		<SeasonSettings
			season={{
				_id: season._id,
				title: season.title,
				start: season.start,
				end: season.end,
				lengthMinutes: season.lengthMinutes,
				defaultQuestPoints: season.defaultQuestPoints ?? null,
				placeRadius: season.placeRadius ?? defaultPlaceRadius,
				shuffleArcs: season.shuffleArcs,
				registrationOpen: season.registrationOpen,
				finisherBonuses: season.finisherBonuses ?? [],
				finishers: season.finishers ?? [],
			}}
			teams={teams.map(({ _id, name }) => ({ _id, name }))}
			now={Date.now()}
		/>
	)
}
