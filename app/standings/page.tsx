import { redirect } from "next/navigation"
import { StandingsScreen } from "@/components/standings/standings-screen"
import { requireTeam } from "@/lib/auth/guards"
import { seasonChannel, teamChannel } from "@/lib/events/bus"
import { loadStandings } from "@/lib/game/game"

export default async function Standings() {
	const team = await requireTeam()
	const standings = await loadStandings(team)
	if (standings.lifecycleState === "waiting" || standings.lifecycleState === "countdown") redirect("/")
	const channels = [teamChannel(team._id)]
	if (team.seasonId) channels.push(seasonChannel(team.seasonId))
	return <StandingsScreen initial={standings} channels={channels} initialNow={Date.now()} />
}
