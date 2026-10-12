import { notFound } from "next/navigation"
import { SeasonSettings } from "@/components/admin/season-settings"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason } from "@/lib/db/seasons"

export default async function SettingsPage({ params }: PageProps<"/admin/seasons/[seasonId]/settings">) {
	await requireAdmin()
	const { seasonId } = await params
	const season = await getSeason(seasonId)
	if (!season) notFound()
	return (
		<SeasonSettings
			season={{
				_id: season._id,
				title: season.title,
				start: season.start,
				end: season.end,
				lengthMinutes: season.lengthMinutes,
				shuffleArcs: season.shuffleArcs,
				registrationOpen: season.registrationOpen,
			}}
			now={Date.now()}
		/>
	)
}
