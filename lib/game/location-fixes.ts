import { type Fix, fixAgeMs, fixTtlMs, guidanceWindowMs } from "@/lib/domain/location"

type PhoneFix = { teamId: string; phoneId: string; fix: Fix; receivedAt: number }
type GuidanceHistory = { questId: string; fixes: { fix: Fix; receivedAt: number }[] }
const cache = globalThis as typeof globalThis & {
	theGameLocationFixes?: Map<string, PhoneFix>
	theGameGuidanceHistory?: Map<string, GuidanceHistory>
}
cache.theGameLocationFixes ??= new Map()
cache.theGameGuidanceHistory ??= new Map()
const fixes = cache.theGameLocationFixes
const histories = cache.theGameGuidanceHistory

function prune(now: number) {
	for (const [key, { fix, receivedAt }] of fixes) {
		if (fixAgeMs(fix, receivedAt, now) > fixTtlMs) fixes.delete(key)
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

export function recordGuidanceFix(teamId: string, phoneId: string, questId: string, fix: Fix, now = Date.now()): Fix[] {
	for (const [key, history] of histories) {
		history.fixes = history.fixes.filter(
			({ fix, receivedAt }) => now - fix.at <= guidanceWindowMs && now - receivedAt <= guidanceWindowMs,
		)
		if (!history.fixes.length) histories.delete(key)
	}
	const key = JSON.stringify([teamId, phoneId])
	let history = histories.get(key)
	if (!history || history.questId !== questId) {
		history = { questId, fixes: [] }
		histories.set(key, history)
	}
	const previous = history.fixes.map(({ fix }) => ({ ...fix }))
	history.fixes.push({ fix: { ...fix }, receivedAt: now })
	return previous
}
