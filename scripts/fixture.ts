import type { Admin, Arc, Quest, Season, Team, TeamQuestProgress } from "@/lib/domain/schemas"
import { hintPenalty } from "@/lib/domain/scoring"

const minute = 60_000

export const backwardsLogAsset = "/assets/3f9c1a7e-5b2d-4c8a-9e61-0d4f7b2a6c13.png"
export const gatherThePiecesAsset = "/assets/7a91c4e2-6d35-4b80-a1f7-2c9e5d6b3084.png"

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
					drop: { fullMinutes: 10, dropMinutes: 20, floor: 5 },
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
			quest(
				"svedala-station",
				"Svedala station",
				20,
				"Trains to Malmö stop here twice an hour. Stand where the tickets are sold and the quest is yours.",
				[],
				[["Look for the yellow ticket machine.", 5]],
				{
					displayTitle: "Next stop",
					location: {
						guidance: "warmer",
						places: [{ id: "svedala-station-place", lat: 55.50682, lng: 13.23289, radius: 40 }],
					},
				},
			),
			quest(
				"three-corners",
				"Three corners",
				25,
				"The old town was laid out from three stones. Stand on all three at once and the town will tell you where to go next.\n\nSplit up. Each circle needs one of you inside it.",
				[],
				[],
				{
					displayTitle: "Three corners",
					location: {
						guidance: "map",
						places: [
							{ id: "three-corners-place-1", lat: 55.5074, lng: 13.2346, radius: 35 },
							{ id: "three-corners-place-2", lat: 55.50793, lng: 13.235, radius: 38 },
							{ id: "three-corners-place-3", lat: 55.50728, lng: 13.23548, radius: 40 },
						],
					},
				},
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
				"The keeper's chart was torn into sixteen pieces. Put them back together to find the way forward.",
				[],
				[
					["Fog horn morse gave you SOS.", 3],
					["Three letters, one word.", 5],
				],
				{
					assetPath: gatherThePiecesAsset,
					puzzle: { rows: 4, cols: 4, showFull: false },
				},
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

const teamSpecs: {
	_id: string
	name: string
	order: string[]
	solved: number
	reveals: Record<string, number>
	currentLocation?: "svedala-station" | "three-corners"
}[] = [
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
		currentLocation: "three-corners",
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
		currentLocation: "three-corners",
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
		currentLocation: "svedala-station",
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
		finisherBonuses: [50, 20],
		finishers: [],
		_id: "cipher-night-2026",
		title: "Cipher Night 2026",
		lengthMinutes: 120,
		defaultQuestPoints: null,
		placeRadius: 40,
		start: new Date(start),
		end: new Date(start + 120 * minute),
		shuffleArcs: true,
		registrationOpen: true,
		arcs: structuredClone(arcs),
	}
	const quests = new Map(arcs.flatMap((arc) => arc.quests.map((q) => [q.id, q] as const)))

	const teams = teamSpecs.map(({ _id, name, order, solved, reveals, currentLocation }): FixtureTeam => {
		const questOrder = [...order, ...finale]
		questOrder.splice(solved + 1, 0, "svedala-station")
		questOrder.splice(solved + 2, 0, "three-corners")
		if (currentLocation) {
			const locationIndex = questOrder.indexOf(currentLocation)
			const displacedQuest = questOrder[solved]
			if (locationIndex < 0 || !displacedQuest) throw new Error("fixture")
			questOrder[solved] = currentLocation
			questOrder[locationIndex] = displacedQuest
		}
		const step = (now.getTime() - start) / (solved + 1)
		const progress = questOrder.slice(0, solved + 1).map((questId, index): TeamQuestProgress => {
			const { hints, points } = quests.get(questId) as Quest
			const hintsRevealed = hints.slice(0, reveals[questId] ?? 0).map((hint, hintIndex) => ({
				hintId: _id === "team-lagom" && questId === "backwards-log" ? "backwards-log-deleted-hint" : hint.id,
				text: hint.text,
				points: hint.points,
				revealedAt: new Date(start + index * step + ((hintIndex + 1) * step) / 4),
			}))
			if (index === solved) {
				return {
					questId,
					hintsRevealed,
					pointsEarned: 0,
					...(_id === "team-ravarna" && questId === "gather-the-pieces"
						? {
								puzzle: {
									version: 8,
									spots: [
										{ cell: 1 },
										{ cell: 0 },
										{ cell: 2 },
										{ cell: 3 },
										{ cell: 4 },
										{ cell: 5 },
										{ cell: 6 },
										{ cell: 7 },
										{ x: 0.12, y: 0.16 },
										{ x: 0.38, y: 0.72 },
										{ x: 0.67, y: 0.2 },
										{ x: 0.83, y: 0.46 },
										{ x: 0.24, y: 0.87 },
										{ x: 0.54, y: 0.4 },
										{ x: 0.91, y: 0.82 },
										{ x: 0.46, y: 0.08 },
									],
								},
							}
						: {}),
				}
			}
			const pointsEarned = (points ?? 0) - hintPenalty(hintsRevealed)
			return { questId, solvedAt: new Date(start + (index + 1) * step), hintsRevealed, pointsEarned }
		})
		if (_id === "team-lagom") {
			progress.push({
				questId: "removed-quest",
				pointsEarned: 0,
				hintsRevealed: [
					{
						hintId: "removed-quest-h1",
						text: "Look beneath the old pier.",
						points: 5,
						revealedAt: new Date(start + step / 8),
					},
				],
			})
		}
		return {
			_id,
			name,
			password: name.toLowerCase(),
			seasonId: season._id,
			questOrder,
			questIndex: solved,
			...(_id === "team-ninjas" ? { reachedAt: new Date(now.getTime() - 15 * minute) } : {}),
			score: progress.reduce((sum, entry) => sum + entry.pointsEarned, 0),
			completed: false,
			progress,
		}
	})

	return { season, teams, admins: [{ _id: "admin", name: "admin", password: "admin" }] }
}
