"use server"

import { redirect } from "next/navigation"
import { getPuzzleTiles } from "@/lib/assets/puzzle-tiles"
import { requireAdmin } from "@/lib/auth/guards"
import { sessionOptions } from "@/lib/auth/session"
import { createSeason } from "@/lib/db/seasons"
import { NewSeasonTitle } from "@/lib/domain/admin-seasons"
import { pieceIds } from "@/lib/domain/puzzle"
import { Puzzle } from "@/lib/domain/schemas"

export type CreateSeasonState = { error?: string }

export async function getPuzzlePreviewAssets(questId: string, assetPath: string, value: unknown) {
	await requireAdmin()
	const { rows, cols } = Puzzle.parse(value)
	const [{ aspect }, ids] = await Promise.all([
		getPuzzleTiles(assetPath, rows, cols),
		pieceIds(questId, assetPath, rows, cols, sessionOptions().password),
	])
	const tileQuery = `?${new URLSearchParams({ assetPath, rows: String(rows), cols: String(cols) })}`
	return { aspect, ids, fullUrl: `/api/puzzle/${questId}/full${tileQuery}`, tileQuery }
}

export async function createSeasonAction(_prev: CreateSeasonState, formData: FormData): Promise<CreateSeasonState> {
	await requireAdmin()
	const title = NewSeasonTitle.safeParse(formData.get("title"))
	if (!title.success) return { error: "Season titles are 1 to 60 characters." }
	const season = await createSeason({
		title: title.data,
		lengthMinutes: 60,
		start: null,
		end: null,
		shuffleArcs: false,
		arcs: [],
	})
	redirect(`/admin/seasons/${season._id}`)
}
