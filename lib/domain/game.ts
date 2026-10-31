import { playableArcs } from "./playable-quests"
import type { Place, Quest, Season, Spot, Team, TeamQuestProgress } from "./schemas"
import { hintPenalty, timeWorth } from "./scoring"

export const maxAnswerLength = 200

export const normalizeAnswer = (answer: string) => answer.normalize("NFC").trim().toLowerCase()

export function matchesAnswer(submitted: string, answers: string[]): boolean {
	const normalized = normalizeAnswer(submitted)
	return answers.some((answer) => normalizeAnswer(answer) === normalized)
}

export function currentWorth(quest: Quest, progress: Pick<TeamQuestProgress, "hintsRevealed">, elapsedMs = 0): number {
	return (timeWorth(quest.points, quest.drop, elapsedMs) ?? 0) - hintPenalty(progress.hintsRevealed)
}

export function scoreForSolve(quest: Quest, progress: Pick<TeamQuestProgress, "hintsRevealed">, elapsedMs = 0): number {
	return Math.max(0, currentWorth(quest, progress, elapsedMs))
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
	const playable = playableArcs(season)
	const arcs = season.shuffleArcs ? shuffle(playable, random) : playable
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

export function questCounts(team: Pick<Team, "questOrder" | "progress">): { solved: number; total: number } {
	const order = new Set(team.questOrder)
	return {
		solved: team.progress.filter((entry) => entry.solvedAt && order.has(entry.questId)).length,
		total: team.questOrder.length,
	}
}

export function paceFromCounts({
	start,
	end,
	solved,
	total,
	now,
}: Pick<Season, "start" | "end"> & {
	solved: number
	total: number
	now: Date
}): Pace | null {
	if (!start || !end || end.getTime() <= start.getTime() || total === 0) return null
	const duration = end.getTime() - start.getTime()
	const elapsed = Math.min(Math.max(now.getTime() - start.getTime(), 0), duration)
	const timeFraction = elapsed / duration
	const timePercent = 100 * timeFraction
	const solvedPercent = 100 * (solved / total)
	const behindPercent = (100 * (elapsed * total - solved * duration)) / (duration * total)
	const band =
		behindPercent <= 0 ? "pace-ok" : behindPercent <= 10 ? "pace-1" : behindPercent <= 20 ? "pace-2" : "pace-3"
	return { timePercent, solvedPercent, behindPercent, band, n: Math.round(timeFraction * total) - solved }
}

export function pace(
	season: Pick<Season, "start" | "end">,
	team: Pick<Team, "questOrder" | "progress">,
	now: Date,
): Pace | null {
	return paceFromCounts({ ...season, ...questCounts(team), now })
}

export function paceLabel(n: number): string {
	if (n > 0) return `${n} behind`
	if (n < 0) return `${-n} ahead`
	return "On pace"
}

export function pacePercentLabel(behindPercent: number): string {
	if (behindPercent > 0) return `${Math.ceil(behindPercent)}% behind`
	const aheadPercent = Math.floor(-behindPercent)
	return aheadPercent > 0 ? `${aheadPercent}% ahead` : "On pace"
}

const ordinalPluralRules = new Intl.PluralRules("en", { type: "ordinal" })

export function ordinal(n: number): string {
	const suffix = ordinalPluralRules.select(n)
	return `${n}${suffix === "one" ? "st" : suffix === "two" ? "nd" : suffix === "few" ? "rd" : "th"}`
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

export type PuzzleAssets = { ids: string[]; aspect: number; fullUrl: string; tileQuery?: string }

export type PlayerPuzzle = {
	rows: number
	cols: number
	aspect: number
	pieces: { id: string; spot: Spot }[]
	fullUrl: string | null
	tileQuery?: string
}

export type PlayerQuest = Pick<Quest, "id" | "displayTitle" | "content" | "points"> & {
	assetPath?: string | null
	puzzle?: PlayerPuzzle | null
	location?: { guidance: "none" | "warmer" } | { guidance: "map"; places: Pick<Place, "lat" | "lng" | "radius">[] }
	hasAnswers?: boolean
	drop: (NonNullable<Quest["drop"]> & { reachedAt: number }) | null
	hintPenalty: number
	worth: number
	hints: PlayerHint[]
}

export function playerView(
	quest: Quest,
	progress?: TeamQuestProgress,
	assets?: PuzzleAssets,
	reachedAt = new Date(),
	now = new Date(),
): PlayerQuest {
	const revealed = progress?.hintsRevealed ?? []
	const puzzleState = progress?.puzzle
	let puzzle: PlayerPuzzle | null = null
	if (quest.puzzle && assets && puzzleState) {
		if (
			puzzleState.spots.length !== quest.puzzle.rows * quest.puzzle.cols ||
			assets.ids.length !== puzzleState.spots.length
		) {
			throw new Error("Puzzle piece metadata does not match board")
		}
		puzzle = {
			rows: quest.puzzle.rows,
			cols: quest.puzzle.cols,
			aspect: assets.aspect,
			pieces: puzzleState.spots
				.map((spot, index) => ({ id: assets.ids[index] as string, spot: { ...spot } }))
				.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
			fullUrl: quest.puzzle.showFull ? assets.fullUrl : null,
			...(assets.tileQuery ? { tileQuery: assets.tileQuery } : {}),
		}
	}
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
		...(quest.puzzle ? { puzzle, hasAnswers: quest.answers.length > 0 } : { assetPath: quest.assetPath }),
		...(quest.location
			? {
					location:
						quest.location.guidance === "map"
							? {
									guidance: "map",
									places: quest.location.places.map(({ lat, lng, radius }) => ({ lat, lng, radius })),
								}
							: { guidance: quest.location.guidance ?? "none" },
					hasAnswers: quest.answers.length > 0,
				}
			: {}),
		points: quest.points,
		drop: quest.drop
			? {
					fullMinutes: quest.drop.fullMinutes,
					dropMinutes: quest.drop.dropMinutes,
					floor: quest.drop.floor,
					reachedAt: reachedAt.getTime(),
				}
			: null,
		hintPenalty: hintPenalty(revealed),
		worth: currentWorth(quest, { hintsRevealed: revealed }, now.getTime() - reachedAt.getTime()),
		hints: shown.map((hint, index) =>
			"hintId" in hint
				? { id: hint.hintId, position: index + 1, points: hint.points, text: hint.text, revealed: true }
				: { id: hint.id, position: index + 1, points: hint.points, revealed: false },
		),
	}
}

export const hasEnded = (season: Pick<Season, "end">, now: Date) => season.end !== null && now >= season.end

export function boardSeasons<T extends Pick<Season, "start" | "end">>(
	seasons: T[],
	now: Date,
): { running: T | null; final: T | null; nextStart: Date | null } {
	let running: T | null = null
	let final: T | null = null
	let nextStart: Date | null = null
	for (const season of seasons) {
		if (season.start && season.start > now && (!nextStart || season.start < nextStart)) nextStart = season.start
		if (hasEnded(season, now)) {
			if (!final?.end || (season.end && season.end > final.end)) final = season
		} else if (season.start && season.start <= now && (!running?.start || season.start > running.start)) {
			running = season
		}
	}
	return { running, final, nextStart }
}

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
		null
	)
}

export function findQuest(season: Pick<Season, "arcs">, questId: string | undefined): Quest | undefined {
	return playableArcs(season)
		.flatMap((arc) => arc.quests)
		.find((quest) => quest.id === questId)
}

export function currentQuest(
	season: Pick<Season, "arcs">,
	team: Pick<Team, "questOrder" | "questIndex" | "progress">,
): { quest: Quest; progress: TeamQuestProgress | undefined } | undefined {
	const quest = findQuest(season, team.questOrder[team.questIndex])
	return quest && { quest, progress: team.progress.find((entry) => entry.questId === quest.id) }
}

export const isRevealed = (progress: Pick<TeamQuestProgress, "hintsRevealed"> | undefined, hintId: string) =>
	progress?.hintsRevealed.some((snapshot) => snapshot.hintId === hintId) ?? false

export type RailArc = { arcId: string; segments: { questId: string; state: "solved" | "current" | "todo" }[] }

export function rail(
	season: Pick<Season, "arcs">,
	team: Pick<Team, "questOrder" | "questIndex" | "progress">,
): RailArc[] {
	const solved = new Set(team.progress.filter((entry) => entry.solvedAt).map((entry) => entry.questId))
	const current = team.questOrder[team.questIndex]
	return playableArcs(season).map((arc) => ({
		arcId: arc.id,
		segments: arc.quests.map(({ id }) => ({
			questId: id,
			state: solved.has(id) ? "solved" : id === current ? "current" : "todo",
		})),
	}))
}

export type StandingsRow = {
	rank: number
	id: string
	name: string
	score: number
	solved: number
	total: number
	rail: RailArc[]
	you: boolean
}

export function standingsRows(
	season: Pick<Season, "arcs">,
	teams: Pick<Team, "_id" | "name" | "score" | "progress" | "questOrder" | "questIndex">[],
	youId: string,
	showCurrent: boolean,
): StandingsRow[] {
	return rankTeams(teams).map((team) => {
		const you = team._id === youId
		return {
			rank: team.rank,
			id: team._id,
			name: team.name,
			score: team.score,
			...questCounts(team),
			rail: rail(season, team).map(({ arcId, segments }) => ({
				arcId,
				segments: segments.map(({ questId, state }) => ({
					questId,
					state: state === "current" && (!you || !showCurrent) ? "todo" : state,
				})),
			})),
			you,
		}
	})
}

export type StructuralEdit = { kind: "addQuest"; questId: string } | { kind: "deleteQuest"; questIds: string[] }

export type StructuralEditImpact =
	| { kind: "addQuest"; added: string[]; completed: number }
	| { kind: "deleteQuest"; onIt: string[]; notReached: string[]; solved: number }

type EditableTeam = Pick<Team, "_id" | "name" | "questOrder" | "questIndex" | "completed" | "progress" | "reachedAt">

type TeamEditOutcome = "added" | "completed" | "onIt" | "notReached" | "solved" | "unchanged"

function editTeam<T extends EditableTeam>(
	team: T,
	edit: StructuralEdit,
	random: () => number,
	now: Date,
): { team: T | null; outcome: TeamEditOutcome } {
	const { questOrder, questIndex } = team
	if (edit.kind === "addQuest") {
		if (team.completed) return { team: null, outcome: "completed" }
		if (!questOrder.length) return { team: null, outcome: "unchanged" }
		const slot = questIndex + 1 + Math.floor(random() * (questOrder.length - questIndex))
		return { team: { ...team, questOrder: questOrder.toSpliced(slot, 0, edit.questId) }, outcome: "added" }
	}
	const questIds = new Set(edit.questIds)
	if (!questOrder.length || !questIds.size) return { team: null, outcome: "unchanged" }
	const currentQuestId = questOrder[questIndex]
	if (currentQuestId !== undefined && questIds.has(currentQuestId)) {
		const remaining = questOrder.filter((questId, index) => index < questIndex || !questIds.has(questId))
		const skipped = team.progress.find((entry) => entry.questId === currentQuestId)
		return {
			team: {
				...team,
				questOrder: remaining,
				completed: questIndex >= remaining.length,
				...(questIndex < remaining.length ? { reachedAt: now } : {}),
				progress: [
					...team.progress.filter((entry) => entry !== skipped),
					{ questId: currentQuestId, hintsRevealed: skipped?.hintsRevealed ?? [], pointsEarned: 0 },
				],
			},
			outcome: "onIt",
		}
	}
	if (questOrder.some((questId, index) => index > questIndex && questIds.has(questId))) {
		return {
			team: {
				...team,
				questOrder: questOrder.filter((questId, index) => index <= questIndex || !questIds.has(questId)),
			},
			outcome: "notReached",
		}
	}
	if (
		edit.questIds.every((questId) => {
			const position = questOrder.indexOf(questId)
			return position >= 0 && position < questIndex
		})
	) {
		return { team: null, outcome: "solved" }
	}
	return { team: null, outcome: "unchanged" }
}

export function applyStructuralEdit<T extends EditableTeam>(
	teams: T[],
	edit: StructuralEdit,
	random: () => number = Math.random,
	now = new Date(),
): { teams: T[]; affected: string[]; impact: StructuralEditImpact } {
	const affected: string[] = []
	const impact: StructuralEditImpact =
		edit.kind === "addQuest"
			? { kind: "addQuest", added: [], completed: 0 }
			: { kind: "deleteQuest", onIt: [], notReached: [], solved: 0 }
	const edited = teams.map((team) => {
		const { team: changed, outcome } = editTeam(team, edit, random, now)
		if (impact.kind === "addQuest") {
			if (outcome === "added") impact.added.push(team.name)
			if (outcome === "completed") impact.completed++
		} else {
			if (outcome === "onIt") impact.onIt.push(team.name)
			if (outcome === "notReached") impact.notReached.push(team.name)
			if (outcome === "solved") impact.solved++
		}
		if (!changed) return team
		affected.push(team._id)
		return changed
	})
	return { teams: edited, affected, impact }
}
