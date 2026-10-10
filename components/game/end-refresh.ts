export function endRefreshDelay(end: number, now: number, attempt: number): number {
	return Math.max(end - now, attempt === 0 ? 0 : Math.min(1000 * 2 ** (attempt - 1), 30_000))
}
