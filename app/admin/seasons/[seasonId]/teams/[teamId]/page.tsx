import { redirect } from "next/navigation"
import { DeleteTeamButton } from "@/components/admin/delete-team-button"
import { ResetPassword } from "@/components/admin/reset-password"
import { TeamHeader } from "@/components/admin/team-header"
import { TeamHistory } from "@/components/admin/team-history"
import { TeamPreview } from "@/components/admin/team-preview"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason } from "@/lib/db/seasons"
import { listSeasonTeams } from "@/lib/db/teams"
import { teamHistory } from "@/lib/domain/team-history"

export default async function TeamPage({ params }: PageProps<"/admin/seasons/[seasonId]/teams/[teamId]">) {
	await requireAdmin()
	const { seasonId, teamId } = await params
	const season = await getSeason(seasonId)
	if (!season) redirect(`/admin/seasons/${seasonId}/teams`)
	const teams = await listSeasonTeams(seasonId)
	const now = Date.now()
	const team = teams.find((team) => team._id === teamId)
	if (!team) redirect(`/admin/seasons/${seasonId}/teams`)
	return (
		<>
			<TeamHeader seasonId={seasonId} name={team.name} />
			<TeamHistory history={teamHistory(season, team, new Date(now))} />
			<ResetPassword key={teamId} seasonId={seasonId} teamId={teamId} />
			<div className="mx-4 mt-6 border-t border-z1 py-6">
				<DeleteTeamButton key={teamId} seasonId={seasonId} teamId={teamId} name={team.name} />
			</div>
			<section className="mt-6 px-4 pb-8 lg:hidden">
				<TeamPreview season={season} team={team} teams={teams} now={now} />
			</section>
		</>
	)
}
