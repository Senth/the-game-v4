"use client"

import { useEffect, useState } from "react"
import { getPuzzlePreviewAssets } from "@/app/admin/actions"
import type { PuzzleAssets } from "@/lib/domain/game"
import { Puzzle, type Quest } from "@/lib/domain/schemas"

export function usePuzzlePreviewAssets(quest?: Pick<Quest, "id" | "assetPath" | "puzzle">) {
	const id = quest?.id
	const assetPath = quest?.assetPath
	const rows = quest?.puzzle?.rows
	const cols = quest?.puzzle?.cols
	const key = JSON.stringify([id, assetPath, rows, cols])
	const [loaded, setLoaded] = useState<{ key: string; assets: PuzzleAssets } | null>(null)
	useEffect(() => {
		if (!id || !assetPath || !rows || !cols || !Puzzle.safeParse({ rows, cols }).success) return
		let cancelled = false
		getPuzzlePreviewAssets(id, assetPath, { rows, cols }).then(
			(assets) => {
				if (!cancelled) setLoaded(assets ? { key, assets } : null)
			},
			() => {
				if (!cancelled) setLoaded(null)
			},
		)
		return () => {
			cancelled = true
		}
	}, [id, assetPath, rows, cols, key])
	return loaded?.key === key ? loaded.assets : undefined
}
