import type { RevealedHint } from "./schemas"

export function hintPenalty(snapshots: RevealedHint[]): number {
	return snapshots.reduce((sum, snapshot) => sum + snapshot.points, 0)
}
