import type { Admin, Arc, Quest, Season, Team, TeamQuestProgress } from "@/lib/domain/schemas"
import { hintPenalty } from "@/lib/domain/scoring"

const minute = 60_000

export const backwardsLogAsset = "/assets/3f9c1a7e-5b2d-4c8a-9e61-0d4f7b2a6c13.png"

function quest(
	id: string,
	internalTitle: string,
	points: number,
	content: string,
	answers: string[],
	hints: [string, number][],
	extra: Partial<Quest> = {},
): Quest {
	return {
		id,
		displayTitle: internalTitle,
		internalTitle,
		content,
		assetPath: null,
		answers,
		points,
		adminNotes: "",
		hints: hints.map(([text, hintPoints], index) => ({ id: `${id}-h${index + 1}`, text, points: hintPoints })),
		...extra,
	}
}

const arcs: Arc[] = [
	{
		id: "lighthouse",
		title: "Lighthouse",
		shuffleQuests: true,
		quests: [
			quest(
				"backwards-log",
				"Backwards log",
				20,
				"The keeper wrote one line every night. On the last night he wrote it backwards, and the ships stopped coming.\n\nRead the log the way the keeper meant it.",
				["lighthouse", "fyren"],
				[
					["Start from the bottom.", 5],
					["Every line is a word. Read the last letters, top to bottom, and you have it.", 10],
					["The answer is a place on the coast.", 20],
				],
				{
					displayTitle: "The keeper's last log",
					assetPath: backwardsLogAsset,
					adminNotes: "The image is the last page of the log.",
				},
			),
			quest(
				"fog-horn-morse",
				"Fog horn morse",
				10,
				"Through the fog the horn sounds three short blasts, three long blasts, then three short blasts again.",
				["sos"],
				[
					["Dots are short, dashes are long.", 2],
					["Count the seconds between blasts, then write them down in order.", 5],
				],
			),
			quest(
				"keepers-ledger",
				"Keeper's ledger",
				15,
				"The last column of the ledger reads 8 5 12 16. The keeper never needed oil, only someone to read it.",
				["help"],
				[["A is 1.", 3]],
			),
			quest(
				"lamp-room",
				"Lamp room",
				15,
				"The lamp turns once every 12 seconds. How many turns does it make in one hour?",
				["300"],
				[
					["There are 3600 seconds in an hour.", 2],
					["Divide.", 5],
				],
			),
		],
	},
	{
		id: "old-town",
		title: "Old Town",
		shuffleQuests: true,
		quests: [
			quest(
				"church-bells",
				"Church bells",
				10,
				"The church bells ring 2 times, then 5, then 12, then 12. Letters, not numbers.",
				["bell"],
				[["A is 1.", 2]],
			),
			quest(
				"cobblestones",
				"Cobblestones",
				15,
				"The square is paved in four rows of seven cobblestones. Two are missing. How many are left?",
				["26"],
				[
					["Rows times stones per row.", 2],
					["There are 28 before the missing ones.", 4],
				],
			),
			quest(
				"bakers-riddle",
				"Baker's riddle",
				10,
				"The baker asks: what has to be broken before you can use it?",
				["egg", "an egg"],
				[
					["The baker uses dozens every morning.", 3],
					["It comes from a hen.", 5],
				],
			),
			quest(
				"clock-tower",
				"Clock tower",
				15,
				"The clock tower shows a quarter past three. How many degrees lie between the hands?",
				["7.5"],
				[
					["The hour hand moves too.", 2],
					["The hour hand moves half a degree per minute.", 5],
				],
			),
			quest(
				"harbour-map",
				"Harbour map",
				20,
				"The harbour map lists six crates: Apples, Nets, Coal, Hemp, Oars, Rope. What keeps the ship in place?",
				["anchor"],
				[
					["Read the crates in order.", 3],
					["Only the first letters count.", 5],
					["Ships drop it in the harbour.", 8],
				],
			),
		],
	},
	{
		id: "finale",
		title: "Finale",
		shuffleQuests: false,
		quests: [
			quest(
				"gather-the-pieces",
				"Gather the pieces",
				15,
				"Take the first letters of the answers to Fog horn morse, Keeper's ledger and Baker's riddle, in that order.",
				["she"],
				[
					["Fog horn morse gave you SOS.", 3],
					["Three letters, one word.", 5],
				],
			),
			quest(
				"the-vault",
				"The vault",
				20,
				"The vault code is the number of turns the lamp makes in an hour plus the cobblestones left in the square.",
				["326"],
				[
					["Look back at Lamp room.", 4],
					["Add Cobblestones.", 8],
				],
			),
			quest(
				"last-word",
				"Last word",
				25,
				"Scratched inside the vault door: RETAW HGIH.",
				["high water", "highwater"],
				[
					["Read it backwards.", 5],
					["The sea is rising.", 10],
				],
			),
		],
	},
]

const finale = ["gather-the-pieces", "the-vault", "last-word"]

const teamSpecs: { _id: string; name: string; order: string[]; solved: number; reveals: Record<string, number> }[] = [
	{
		_id: "team-ravarna",
		name: "Rävarna",
		order: [
			"cobblestones",
			"church-bells",
			"harbour-map",
			"bakers-riddle",
			"clock-tower",
			"lamp-room",
			"backwards-log",
			"keepers-ledger",
			"fog-horn-morse",
		],
		solved: 9,
		reveals: { "bakers-riddle": 1, "lamp-room": 1, "backwards-log": 1 },
	},
	{
		_id: "team-kaos",
		name: "Team Kaos",
		order: [
			"keepers-ledger",
			"backwards-log",
			"lamp-room",
			"fog-horn-morse",
			"clock-tower",
			"church-bells",
			"harbour-map",
			"cobblestones",
			"bakers-riddle",
		],
		solved: 8,
		reveals: { "fog-horn-morse": 2, "harbour-map": 2, "bakers-riddle": 1 },
	},
	{
		_id: "team-fjallrav",
		name: "Fjällräv",
		order: [
			"harbour-map",
			"clock-tower",
			"cobblestones",
			"church-bells",
			"bakers-riddle",
			"fog-horn-morse",
			"keepers-ledger",
			"backwards-log",
			"lamp-room",
		],
		solved: 8,
		reveals: { "church-bells": 1, "backwards-log": 2 },
	},
	{
		_id: "team-byggarna",
		name: "Byggarna",
		order: [
			"lamp-room",
			"fog-horn-morse",
			"backwards-log",
			"keepers-ledger",
			"church-bells",
			"harbour-map",
			"cobblestones",
			"clock-tower",
			"bakers-riddle",
		],
		solved: 7,
		reveals: { "backwards-log": 2, "clock-tower": 1 },
	},
	{
		_id: "team-glada-ganget",
		name: "Glada Gänget",
		order: [
			"church-bells",
			"bakers-riddle",
			"clock-tower",
			"harbour-map",
			"cobblestones",
			"keepers-ledger",
			"fog-horn-morse",
			"lamp-room",
			"backwards-log",
		],
		solved: 7,
		reveals: { "bakers-riddle": 1, "keepers-ledger": 1, "fog-horn-morse": 2 },
	},
	{
		_id: "team-lagom",
		name: "Lagom",
		order: [
			"fog-horn-morse",
			"lamp-room",
			"keepers-ledger",
			"backwards-log",
			"bakers-riddle",
			"church-bells",
			"clock-tower",
			"harbour-map",
			"cobblestones",
		],
		solved: 6,
		reveals: { "lamp-room": 1, "backwards-log": 1, "bakers-riddle": 1 },
	},
	{
		_id: "team-ninjas",
		name: "Ninjas",
		order: [
			"bakers-riddle",
			"clock-tower",
			"church-bells",
			"harbour-map",
			"cobblestones",
			"backwards-log",
			"lamp-room",
			"fog-horn-morse",
			"keepers-ledger",
		],
		solved: 5,
		reveals: { "bakers-riddle": 1, "harbour-map": 1, "backwards-log": 1 },
	},
	{
		_id: "team-kodknackarna",
		name: "Kodknäckarna",
		order: [
			"backwards-log",
			"keepers-ledger",
			"fog-horn-morse",
			"lamp-room",
			"harbour-map",
			"cobblestones",
			"church-bells",
			"bakers-riddle",
			"clock-tower",
		],
		solved: 4,
		reveals: { "backwards-log": 1, "keepers-ledger": 1, "lamp-room": 1, "harbour-map": 1 },
	},
	{
		_id: "team-sista-laget",
		name: "Sista Laget",
		order: [
			"cobblestones",
			"clock-tower",
			"church-bells",
			"bakers-riddle",
			"harbour-map",
			"keepers-ledger",
			"lamp-room",
			"backwards-log",
			"fog-horn-morse",
		],
		solved: 4,
		reveals: { cobblestones: 2, "bakers-riddle": 1, "harbour-map": 1 },
	},
	{
		_id: "team-losenord123",
		name: "Lösenord123",
		order: [
			"lamp-room",
			"keepers-ledger",
			"backwards-log",
			"fog-horn-morse",
			"clock-tower",
			"harbour-map",
			"church-bells",
			"bakers-riddle",
			"cobblestones",
		],
		solved: 2,
		reveals: { "lamp-room": 2, "keepers-ledger": 1 },
	},
]

export type FixtureTeam = Omit<Team, "passwordHash"> & { password: string }
export type FixtureAdmin = Omit<Admin, "passwordHash"> & { password: string }

export function buildFixture(now: Date): { season: Season; teams: FixtureTeam[]; admins: FixtureAdmin[] } {
	const start = now.getTime() - 72.5 * minute
	const season: Season = {
		_id: "cipher-night-2026",
		title: "Cipher Night 2026",
		lengthMinutes: 120,
		start: new Date(start),
		end: new Date(start + 120 * minute),
		shuffleArcs: true,
		registrationOpen: true,
		arcs: structuredClone(arcs),
	}
	const quests = new Map(arcs.flatMap((arc) => arc.quests.map((q) => [q.id, q] as const)))

	const teams = teamSpecs.map(({ _id, name, order, solved, reveals }): FixtureTeam => {
		const step = (now.getTime() - start) / (solved + 1)
		const progress = order.slice(0, solved + 1).map((questId, index): TeamQuestProgress => {
			const { hints, points } = quests.get(questId) as Quest
			const hintsRevealed = hints.slice(0, reveals[questId] ?? 0).map((hint, hintIndex) => ({
				hintId: hint.id,
				text: hint.text,
				points: hint.points,
				revealedAt: new Date(start + index * step + ((hintIndex + 1) * step) / 4),
			}))
			if (index === solved) return { questId, hintsRevealed, pointsEarned: 0 }
			const pointsEarned = (points ?? 0) - hintPenalty(hintsRevealed)
			return { questId, solvedAt: new Date(start + (index + 1) * step), hintsRevealed, pointsEarned }
		})
		return {
			_id,
			name,
			password: name.toLowerCase(),
			seasonId: season._id,
			questOrder: [...order, ...finale],
			questIndex: solved,
			score: progress.reduce((sum, entry) => sum + entry.pointsEarned, 0),
			completed: false,
			progress,
		}
	})

	return { season, teams, admins: [{ _id: "admin", name: "admin", password: "admin" }] }
}
