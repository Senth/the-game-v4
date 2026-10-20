"use client"

import { useEffect, useState } from "react"
import type { PlayerFinisher } from "@/lib/domain/finishers"

export function useFinisherNotices(finishers: PlayerFinisher[] | undefined, scope: string, ownTeamId?: string) {
	const [state, setState] = useState(() => ({
		seen: finishers,
		seenTeamIds: new Set(finishers?.map((entry) => entry.teamId)),
		scope,
		queue: [] as PlayerFinisher[],
		closing: false,
	}))
	if (scope !== state.scope || finishers !== state.seen) {
		const baseline = scope !== state.scope || !state.seen || !finishers
		const seen = new Set(baseline ? [] : state.seenTeamIds)
		const added = (finishers ?? [])
			.filter((entry) => !seen.has(entry.teamId) && entry.teamId !== ownTeamId)
			.toSorted((a, b) => a.place - b.place)
		for (const entry of finishers ?? []) seen.add(entry.teamId)
		setState({
			seen: finishers,
			seenTeamIds: seen,
			scope,
			queue: baseline ? [] : [...state.queue, ...added],
			closing: baseline ? false : state.closing,
		})
	}
	const notice = state.queue[0] ?? null
	const closing = state.closing
	useEffect(() => {
		if (!notice) return
		const timer = setTimeout(
			() =>
				setState((current) =>
					closing ? { ...current, queue: current.queue.slice(1), closing: false } : { ...current, closing: true },
				),
			closing ? 250 : notice.points > 0 ? 8000 : 6000,
		)
		return () => clearTimeout(timer)
	}, [notice, closing])
	return { notice, closing, dismiss: () => setState((current) => ({ ...current, closing: true })) }
}
