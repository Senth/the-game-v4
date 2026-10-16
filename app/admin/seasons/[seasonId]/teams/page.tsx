import { notFound } from "next/navigation"
import { TeamsList } from "@/components/admin/teams-list"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason } from "@/lib/db/seasons"
import { listSeasonTeams } from "@/lib/db/teams"
import { adminTeamRows } from "@/lib/domain/admin-teams"

export default async function TeamsPage({ params }: PageProps<"/admin/seasons/[seasonId]/teams">) {
	await requireAdmin()
	const { seasonId } = await params
	const season = await getSeason(seasonId)
	if (!season) notFound()
	const teams = await listSeasonTeams(seasonId)
	return <TeamsList seasonId={seasonId} rows={adminTeamRows(season, teams, new Date(Date.now()))} />
}
