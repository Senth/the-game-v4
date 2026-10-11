"use server"

import { loadBoard } from "@/lib/game/game"

export async function getBoard() {
	return loadBoard()
}
