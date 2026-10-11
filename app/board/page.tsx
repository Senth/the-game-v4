import { connection } from "next/server"
import { BoardScreen } from "@/components/board/board-screen"
import { boardChannel } from "@/lib/events/bus"
import { loadBoard } from "@/lib/game/game"

export default async function Board() {
	await connection()
	const initial = await loadBoard()
	return <BoardScreen initial={initial} initialNow={Date.now()} channels={[boardChannel]} />
}
