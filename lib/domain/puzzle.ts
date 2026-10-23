import { type PuzzleState, type Season, Spot, type Team } from "./schemas"

export async function pieceIds(
	questId: string,
	assetPath: string,
	rows: number,
	cols: number,
	secret: string,
): Promise<string[]> {
	const encoder = new TextEncoder()
	const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
		"sign",
	])
	return Promise.all(
		Array.from({ length: rows * cols }, async (_, index) => {
			const signature = await crypto.subtle.sign(
				"HMAC",
				key,
				encoder.encode(`${questId}:${assetPath}:${rows}x${cols}:${index}`),
			)
			return btoa(String.fromCharCode(...new Uint8Array(signature)))
				.replaceAll("+", "-")
				.replaceAll("/", "_")
				.slice(0, 16)
		}),
	)
}

export function randomSpread(n: number, rng: () => number = Math.random): Spot[] {
	return Array.from({ length: n }, () => ({ x: rng(), y: rng() }))
}

export function snapCell(rows: number, cols: number, x: number, y: number): Spot {
	const col = Math.min(cols - 1, Math.max(0, Math.floor(x * cols)))
	const row = Math.min(rows - 1, Math.max(0, Math.floor(y * rows)))
	return { cell: row * cols + col }
}

export function dropPiece(state: PuzzleState, index: number, target: Spot): PuzzleState {
	const origin = state.spots[index]
	if (!Number.isInteger(index) || !origin) throw new Error("Invalid puzzle piece index")
	const spot = Spot.parse(target)
	if ("cell" in spot && spot.cell >= state.spots.length) throw new Error("Invalid puzzle cell")
	const occupant =
		"cell" in spot ? state.spots.findIndex((placed) => "cell" in placed && placed.cell === spot.cell) : -1
	return {
		version: state.version + 1,
		spots: state.spots.map((placed, piece) => ({ ...(piece === index ? spot : piece === occupant ? origin : placed) })),
	}
}

export function isSolved(state: PuzzleState): boolean {
	return state.spots.length > 0 && state.spots.every((spot, index) => "cell" in spot && spot.cell === index)
}

export function puzzleLocked(
	season: Pick<Season, "_id">,
	teams: Pick<Team, "seasonId" | "questOrder" | "questIndex" | "progress">[],
	questId: string,
): number {
	return teams.filter(
		(team) =>
			team.seasonId === season._id &&
			(team.questOrder[team.questIndex] === questId || team.progress.some((entry) => entry.questId === questId)),
	).length
}
