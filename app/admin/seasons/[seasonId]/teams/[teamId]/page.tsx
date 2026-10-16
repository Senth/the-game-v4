import { redirect } from "next/navigation"
import { DeleteTeamButton } from "@/components/admin/delete-team-button"
import { TeamHeader } from "@/components/admin/team-header"
import { TeamRow } from "@/components/admin/teams-list"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason } from "@/lib/db/seasons"
import { listSeasonTeams } from "@/lib/db/teams"
import { adminTeamRows } from "@/lib/domain/admin-teams"

export default async function TeamPage({ params }: PageProps<"/admin/seasons/[seasonId]/teams/[teamId]">) {
	await requireAdmin()
	const { seasonId, teamId } = await params
	const season = await getSeason(seasonId)
	if (!season) redirect(`/admin/seasons/${seasonId}/teams`)
	const teams = await listSeasonTeams(seasonId)
	const row = adminTeamRows(season, teams, new Date(Date.now())).find((row) => row.id === teamId)
	if (!row) redirect(`/admin/seasons/${seasonId}/teams`)
	return (
		<>
			<TeamHeader seasonId={seasonId} name={row.name} />
			<TeamRow seasonId={seasonId} row={row} summary />
			<div className="mx-4 mt-6 border-t border-z1 py-6">
				<DeleteTeamButton key={teamId} seasonId={seasonId} teamId={teamId} name={row.name} />
			</div>
		</>
	)
}
