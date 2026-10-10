import type { Viewport } from "next"
import { GameScreen } from "@/components/game/game-screen"
import { requireTeam } from "@/lib/auth/guards"
import { seasonChannel, teamChannel } from "@/lib/events/bus"
import { getGame } from "./actions"

export const viewport: Viewport = { interactiveWidget: "resizes-content" }

export default async function Home() {
	const team = await requireTeam()
	const game = await getGame()
	const channels = [teamChannel(team._id)]
	if (team.seasonId) channels.push(seasonChannel(team.seasonId))
	return <GameScreen initial={game} channels={channels} initialNow={Date.now()} />
}
