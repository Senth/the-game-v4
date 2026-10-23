import { readFile } from "node:fs/promises"
import path from "node:path"
import { getPuzzleTiles } from "@/lib/assets/puzzle-tiles"
import { getSession, sessionOptions } from "@/lib/auth/session"
import { getAdmin } from "@/lib/db/admins"
import { getSeason, listSeasons } from "@/lib/db/seasons"
import { getTeam } from "@/lib/db/teams"
import { pieceIds } from "@/lib/domain/puzzle"
import { Puzzle } from "@/lib/domain/schemas"

export const runtime = "nodejs"

export async function GET(request: Request, { params }: { params: Promise<{ questId: string; piece: string }> }) {
	const { kind, id } = await getSession()
	const team = kind === "team" && id ? await getTeam(id) : null
	const admin = kind === "admin" && id ? await getAdmin(id) : null
	if (!team && !admin) return new Response(null, { status: 404 })
	const { questId, piece } = await params
	const seasons = team ? [await getSeason(team.seasonId)] : await listSeasons()
	let quest = seasons
		.flatMap((season) => season?.arcs.flatMap((arc) => arc.quests) ?? [])
		.find((quest) => quest.id === questId)
	const query = new URL(request.url).searchParams
	if (admin && query.has("assetPath")) {
		const puzzle = Puzzle.safeParse({ rows: Number(query.get("rows")), cols: Number(query.get("cols")) })
		if (!quest || !puzzle.success) return new Response(null, { status: 404 })
		quest = { ...quest, assetPath: query.get("assetPath"), puzzle: puzzle.data }
	}
	if (!quest?.puzzle || !quest.assetPath) return new Response(null, { status: 404 })
	if (team) {
		const current = !team.completed && team.questOrder[team.questIndex] === questId
		const solved = team.progress.some((entry) => entry.questId === questId && entry.solvedAt)
		if (quest.hidden || (!current && !solved) || (piece === "full" && !quest.puzzle.showFull)) {
			return new Response(null, { status: 404 })
		}
	}
	const { rows, cols } = quest.puzzle
	const ids = await pieceIds(questId, quest.assetPath, rows, cols, sessionOptions().password)
	const index = ids.indexOf(piece)
	if (piece !== "full" && index < 0) return new Response(null, { status: 404 })
	try {
		const { directory } = await getPuzzleTiles(quest.assetPath, rows, cols)
		const bytes = await readFile(path.join(directory, piece === "full" ? "full.webp" : `${index}.webp`))
		return new Response(bytes, {
			headers: {
				"Content-Type": "image/webp",
				"Cache-Control": "private, max-age=3600",
				"X-Content-Type-Options": "nosniff",
			},
		})
	} catch {
		return new Response(null, { status: 404 })
	}
}
