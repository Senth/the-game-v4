import type { Quest, Season, Team, TeamQuestProgress } from "./schemas"
import { hintPenalty } from "./scoring"

const normalizeAnswer = (answer: string) => answer.normalize("NFC").trim().toLowerCase()

export function matchesAnswer(submitted: string, answers: string[]): boolean {
	const normalized = normalizeAnswer(submitted)
	return answers.some((answer) => normalizeAnswer(answer) === normalized)
}

export function scoreForSolve(quest: Quest, progress: Pick<TeamQuestProgress, "hintsRevealed">): number {
	return (quest.points ?? 0) - hintPenalty(progress.hintsRevealed)
}

function shuffle<T>(items: T[], random: () => number): T[] {
	const copy = [...items]
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1))
		;[copy[i], copy[j]] = [copy[j] as T, copy[i] as T]
	}
	return copy
}

export function buildQuestOrder(season: Season, random: () => number = Math.random): string[] {
	const arcs = season.shuffleArcs ? shuffle(season.arcs, random) : season.arcs
	return arcs.flatMap((arc) => {
		const ids = arc.quests.map((quest) => quest.id)
		return arc.shuffleQuests ? shuffle(ids, random) : ids
	})
}

export type PaceBand = "pace-ok" | "pace-1" | "pace-2" | "pace-3"

export type Pace = {
	timePercent: number
	solvedPercent: number
	behindPercent: number
	band: PaceBand
	n: number
}

export function pace(
	season: Pick<Season, "start" | "end">,
	team: Pick<Team, "questOrder" | "progress">,
	now: Date,
): Pace | null {
	const { start, end } = season
	const total = team.questOrder.length
	if (!start || !end || end.getTime() <= start.getTime() || total === 0) return null
	const duration = end.getTime() - start.getTime()
	const elapsed = Math.min(Math.max(now.getTime() - start.getTime(), 0), duration)
	const timeFraction = elapsed / duration
	const order = new Set(team.questOrder)
	const solved = team.progress.filter((entry) => entry.solvedAt && order.has(entry.questId)).length
	const timePercent = 100 * timeFraction
	const solvedPercent = 100 * (solved / total)
	const behindPercent = (100 * (elapsed * total - solved * duration)) / (duration * total)
	const band =
		behindPercent <= 0 ? "pace-ok" : behindPercent <= 10 ? "pace-1" : behindPercent <= 20 ? "pace-2" : "pace-3"
	return { timePercent, solvedPercent, behindPercent, band, n: Math.round(timeFraction * total) - solved }
}

export function paceLabel(n: number): string {
	if (n > 0) return `${n} behind`
	if (n < 0) return `${-n} ahead`
	return "On pace"
}

type RankableTeam = Pick<Team, "_id" | "name" | "score" | "progress">

function lastSolve(team: RankableTeam): number {
	const times = team.progress.flatMap((entry) => (entry.solvedAt ? [entry.solvedAt.getTime()] : []))
	return times.length ? Math.max(...times) : Number.POSITIVE_INFINITY
}

export function rankTeams<T extends RankableTeam>(teams: T[]): (T & { rank: number })[] {
	const sorted = teams.toSorted(
		(a, b) => b.score - a.score || lastSolve(a) - lastSolve(b) || a.name.localeCompare(b.name),
	)
	const ranked: (T & { rank: number })[] = []
	for (const [index, team] of sorted.entries()) {
		const previous = ranked[index - 1]
		ranked.push({ ...team, rank: previous && previous.score === team.score ? previous.rank : index + 1 })
	}
	return ranked
}

export type StripEntry =
	| { kind: "team"; rank: number; id: string; name: string; score: number; you: boolean }
	| { kind: "gap" }

export function standingsStrip(teams: RankableTeam[], youId: string): StripEntry[] {
	const ranked = rankTeams(teams)
	const youIndex = ranked.findIndex((team) => team._id === youId)
	const you = ranked[youIndex]
	if (!you) return []
	const indexes = you.rank === 1 ? [youIndex] : [...new Set([0, youIndex - 1, youIndex])]
	return indexes.flatMap<StripEntry>((index) => {
		const team = ranked[index] as (typeof ranked)[number]
		const entry: StripEntry = {
			kind: "team",
			rank: team.rank,
			id: team._id,
			name: team.name,
			score: team.score,
			you: index === youIndex,
		}
		return index === youIndex - 1 && index > 1 ? [{ kind: "gap" }, entry] : [entry]
	})
}

export type PlayerHint =
	| { id: string; position: number; points: number; text: string; revealed: true }
	| { id: string; position: number; points: number; revealed: false }

export type PlayerQuest = Pick<Quest, "id" | "displayTitle" | "content" | "assetPath" | "points"> & {
	worth: number
	hints: PlayerHint[]
}

export function playerView(quest: Quest, progress?: TeamQuestProgress): PlayerQuest {
	const revealed = progress?.hintsRevealed ?? []
	const snapshots = new Map(revealed.map((snapshot) => [snapshot.hintId, snapshot]))
	const currentIds = new Set(quest.hints.map((hint) => hint.id))
	const shown = [
		...quest.hints.map((hint) => snapshots.get(hint.id) ?? hint),
		...revealed.filter((snapshot) => !currentIds.has(snapshot.hintId)),
	]
	return {
		id: quest.id,
		displayTitle: quest.displayTitle,
		content: quest.content,
		assetPath: quest.assetPath,
		points: quest.points,
		worth: scoreForSolve(quest, { hintsRevealed: revealed }),
		hints: shown.map((hint, index) =>
			"hintId" in hint
				? { id: hint.hintId, position: index + 1, points: hint.points, text: hint.text, revealed: true }
				: { id: hint.id, position: index + 1, points: hint.points, revealed: false },
		),
	}
}

const hasEnded = (season: Pick<Season, "end">, now: Date) => season.end !== null && now >= season.end

export type LifecycleState = "waiting" | "countdown" | "running" | "completed" | "ended"

export function lifecycleState(
	season: Pick<Season, "start" | "end"> | null,
	team: Pick<Team, "completed">,
	now: Date,
): LifecycleState {
	if (!season?.start) return "waiting"
	if (now < season.start) return "countdown"
	if (team.completed) return "completed"
	if (hasEnded(season, now)) return "ended"
	return "running"
}

export function registrationSeason<T extends Pick<Season, "end" | "registrationOpen">>(
	seasons: T[],
	now: Date,
): T | null {
	return seasons.find((season) => season.registrationOpen && !hasEnded(season, now)) ?? null
}

export function registrationConflict<T extends Pick<Season, "_id" | "end" | "registrationOpen">>(
	seasons: T[],
	seasonId: string,
	now: Date,
): T | null {
	const target = seasons.find((season) => season._id === seasonId)
	if (target && hasEnded(target, now)) return target
	return registrationSeason(
		seasons.filter((season) => season._id !== seasonId),
		now,
	)
}

export function pickLoginTeam<
	T extends Pick<Team, "seasonId">,
	S extends Pick<Season, "_id" | "start" | "end" | "registrationOpen">,
>(candidates: T[], seasons: S[], now: Date): T | null {
	const startOf = (team: T) => seasons.find((season) => season._id === team.seasonId)?.start
	const started = (team: T) => (startOf(team)?.getTime() ?? Number.POSITIVE_INFINITY) <= now.getTime()
	const open = registrationSeason(seasons, now)
	const [latestStarted] = candidates
		.filter(started)
		.toSorted((a, b) => (startOf(b)?.getTime() ?? 0) - (startOf(a)?.getTime() ?? 0))
	return (
		candidates.find((team) => team.seasonId === open?._id) ??
		latestStarted ??
		candidates.find((team) => startOf(team) !== undefined && !started(team)) ??
		candidates.find((team) => team.seasonId === null) ??
		null
	)
}

export type RailArc = { arcId: string; segments: { questId: string; state: "solved" | "current" | "todo" }[] }

export function rail(
	season: Pick<Season, "arcs">,
	team: Pick<Team, "questOrder" | "questIndex" | "progress">,
): RailArc[] {
	const solved = new Set(team.progress.filter((entry) => entry.solvedAt).map((entry) => entry.questId))
	const current = team.questOrder[team.questIndex]
	return season.arcs.map((arc) => ({
		arcId: arc.id,
		segments: arc.quests.map(({ id }) => ({
			questId: id,
			state: solved.has(id) ? "solved" : id === current ? "current" : "todo",
		})),
	}))
}

export type StructuralEdit = { kind: "addQuest"; questId: string } | { kind: "deleteQuest"; questId: string }

type EditableTeam = Pick<Team, "_id" | "questOrder" | "questIndex" | "completed" | "progress">

function editTeam<T extends EditableTeam>(team: T, edit: StructuralEdit, random: () => number): T | null {
	const { questOrder, questIndex } = team
	if (edit.kind === "addQuest") {
		if (team.completed) return null
		const slot = questIndex + 1 + Math.floor(random() * (questOrder.length - questIndex))
		return { ...team, questOrder: questOrder.toSpliced(slot, 0, edit.questId) }
	}
	const position = questOrder.indexOf(edit.questId)
	if (position === -1 || position < questIndex) return null
	const remaining = questOrder.toSpliced(position, 1)
	if (position > questIndex) return { ...team, questOrder: remaining }
	const skipped = team.progress.find((entry) => entry.questId === edit.questId)
	return {
		...team,
		questOrder: remaining,
		completed: questIndex >= remaining.length,
		progress: [
			...team.progress.filter((entry) => entry !== skipped),
			{ questId: edit.questId, hintsRevealed: skipped?.hintsRevealed ?? [], pointsEarned: 0 },
		],
	}
}

export function applyStructuralEdit<T extends EditableTeam>(
	teams: T[],
	edit: StructuralEdit,
	random: () => number = Math.random,
): { teams: T[]; affected: string[] } {
	const affected: string[] = []
	const edited = teams.map((team) => {
		const changed = editTeam(team, edit, random)
		if (!changed) return team
		affected.push(team._id)
		return changed
	})
	return { teams: edited, affected }
}
