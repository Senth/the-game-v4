import { type Fix, fixAgeMs, fixTtlMs, guidanceWindowMs } from "@/lib/domain/location"

type PhoneFix = { teamId: string; phoneId: string; fix: Fix; receivedAt: number }
type GuidanceHistory = { questId: string; fixes: { fix: Fix; receivedAt: number }[] }
const cache = globalThis as typeof globalThis & {
	theGameLocationFixes?: Map<string, PhoneFix>
	theGameGuidanceHistory?: Map<string, GuidanceHistory>
	theGameLocationVersions?: Map<string, number>
}
cache.theGameLocationFixes ??= new Map()
cache.theGameGuidanceHistory ??= new Map()
cache.theGameLocationVersions ??= new Map()
const fixes = cache.theGameLocationFixes
const histories = cache.theGameGuidanceHistory
const versions = cache.theGameLocationVersions

export function teamFixesVersion(teamId: string): number {
	return versions.get(teamId) ?? 0
}

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
	return new Map(teamFixes(teamId, now).map(({ phoneId, fix }) => [phoneId, fix]))
}

export function teamFixes(teamId: string, now = Date.now()): { phoneId: string; fix: Fix; ageMs: number }[] {
	prune(now)
	return [...fixes.values()]
		.filter((entry) => entry.teamId === teamId)
		.map(({ phoneId, fix, receivedAt }) => ({ phoneId, fix: { ...fix }, ageMs: fixAgeMs(fix, receivedAt, now) }))
}

export function fixesForTeams(
	teamIds: string[],
	now = Date.now(),
): { teamId: string; phoneId: string; fix: Fix; expiresInMs: number }[] {
	prune(now)
	const ids = new Set(teamIds)
	return [...fixes.values()]
		.filter(({ teamId }) => ids.has(teamId))
		.map(({ teamId, phoneId, fix, receivedAt }) => ({
			teamId,
			phoneId,
			fix: { ...fix },
			expiresInMs: fixTtlMs - fixAgeMs(fix, receivedAt, now),
		}))
}

export function clearTeamFixes(teamId: string): void {
	versions.set(teamId, teamFixesVersion(teamId) + 1)
	for (const [key, entry] of fixes) if (entry.teamId === teamId) fixes.delete(key)
	for (const key of histories.keys()) if (JSON.parse(key)[0] === teamId) histories.delete(key)
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
