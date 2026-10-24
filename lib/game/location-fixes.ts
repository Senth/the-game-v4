import { type Fix, fixTtlMs } from "@/lib/domain/location"

type PhoneFix = { teamId: string; phoneId: string; fix: Fix; receivedAt: number }
const cache = globalThis as typeof globalThis & { theGameLocationFixes?: Map<string, PhoneFix> }
cache.theGameLocationFixes ??= new Map()
const fixes = cache.theGameLocationFixes

function prune(now: number) {
	for (const [key, { fix, receivedAt }] of fixes) {
		if (now - fix.at > fixTtlMs || now - receivedAt > fixTtlMs) fixes.delete(key)
	}
}

export function recordFix(teamId: string, phoneId: string, fix: Fix, now = Date.now()): void {
	prune(now)
	const key = JSON.stringify([teamId, phoneId])
	const previous = fixes.get(key)
	if (!previous || fix.at >= previous.fix.at) fixes.set(key, { teamId, phoneId, fix: { ...fix }, receivedAt: now })
}

export function latestFixes(teamId: string, now = Date.now()): Map<string, Fix> {
	prune(now)
	return new Map(
		[...fixes.values()].filter((entry) => entry.teamId === teamId).map(({ phoneId, fix }) => [phoneId, { ...fix }]),
	)
}
