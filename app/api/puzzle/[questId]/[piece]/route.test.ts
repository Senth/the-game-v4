import { mkdir, mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { sealData } from "iron-session"
import sharp from "sharp"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { saveAsset } from "@/lib/assets/files"
import { type SessionData, sessionOptions } from "@/lib/auth/session"
import { createAdmin } from "@/lib/db/admins"
import { collections } from "@/lib/db/collections"
import { createSeason } from "@/lib/db/seasons"
import { createTeam, deleteTeam } from "@/lib/db/teams"
import { pieceIds } from "@/lib/domain/puzzle"
import type { Quest, Team } from "@/lib/domain/schemas"
import { useTestDb } from "@/test/db"
import { GET } from "./route"

const cookie = vi.hoisted(() => ({ value: undefined as string | undefined }))
vi.mock("next/headers", () => ({
	cookies: async () => ({ get: () => (cookie.value === undefined ? undefined : { value: cookie.value }) }),
}))

useTestDb()

let directory: string
let assetPath: string
let ids: string[]
let seasonId: string
let current: Team
let future: Team
let solved: Team
let other: Team
let adminId: string
const previousAssetsDir = process.env.ASSETS_DIR

beforeAll(async () => {
	await mkdir(".tmp", { recursive: true })
	directory = await mkdtemp(path.resolve(".tmp/puzzle-route-"))
	process.env.ASSETS_DIR = directory
	assetPath = await saveAsset(
		await sharp({ create: { width: 120, height: 80, channels: 3, background: "red" } })
			.png()
			.toBuffer(),
		"png",
	)
	const quest: Quest = {
		id: "puzzle",
		displayTitle: "Puzzle",
		internalTitle: "Private",
		content: "",
		assetPath,
		puzzle: { rows: 2, cols: 2, showFull: false },
		answers: [],
		points: 20,
		adminNotes: "Private",
		hints: [],
	}
	const season = await createSeason({
		title: "Tiles",
		lengthMinutes: 60,
		start: null,
		end: null,
		shuffleArcs: false,
		arcs: [
			{ id: "arc", title: "Arc", shuffleQuests: false, quests: [quest, { ...quest, id: "hidden", hidden: true }] },
		],
	})
	seasonId = season._id
	const team = {
		name: "Current",
		passwordHash: "hash",
		seasonId,
		questOrder: ["puzzle"],
		questIndex: 0,
		score: 0,
		completed: false,
		progress: [],
	}
	current = await createTeam(team)
	future = await createTeam({ ...team, name: "Future", questOrder: ["earlier", "puzzle"] })
	solved = await createTeam({
		...team,
		name: "Solved",
		questIndex: 1,
		completed: true,
		progress: [{ questId: "puzzle", solvedAt: new Date(), pointsEarned: 20, hintsRevealed: [] }],
	})
	other = await createTeam({ ...team, name: "Other season", seasonId: "another-season" })
	adminId = (await createAdmin({ name: "admin", passwordHash: "hash" }))._id
	ids = await pieceIds("puzzle", assetPath, 2, 2, sessionOptions().password)
})

beforeEach(async () => {
	cookie.value = undefined
	await showFull(false)
})

afterAll(async () => {
	await rm(directory, { recursive: true, force: true })
	if (previousAssetsDir === undefined) delete process.env.ASSETS_DIR
	else process.env.ASSETS_DIR = previousAssetsDir
})

async function login(session: SessionData) {
	const { password, ttl } = sessionOptions()
	cookie.value = await sealData(session, { password, ttl })
}

async function showFull(value: boolean) {
	await (await collections()).seasons.updateOne(
		{ _id: seasonId },
		{ $set: { "arcs.0.quests.0.puzzle.showFull": value } },
	)
}

function get(piece = ids[0] ?? "", questId = "puzzle") {
	return GET(new Request("http://localhost/api/puzzle/test/piece"), { params: Promise.resolve({ questId, piece }) })
}

describe("GET /api/puzzle/[questId]/[piece]", () => {
	it("serves current and solved teams only opaque webp tiles with private caching", async () => {
		for (const team of [current, solved]) {
			await login({ kind: "team", id: team._id })
			const response = await get()
			expect(response.status).toBe(200)
			expect(response.headers.get("Content-Type")).toBe("image/webp")
			expect(response.headers.get("Cache-Control")).toBe("private, max-age=3600")
			expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
			expect(await sharp(Buffer.from(await response.arrayBuffer())).metadata()).toMatchObject({
				width: 60,
				height: 40,
				format: "webp",
			})
		}
	})

	it("returns 404 without a valid live account", async () => {
		expect((await get()).status).toBe(404)
		cookie.value = "garbage"
		expect((await get()).status).toBe(404)
		await login({ kind: "admin", id: "deleted-admin" })
		expect((await get()).status).toBe(404)
		const deleted = await createTeam({ ...current, _id: "deleted-team", name: "Deleted" })
		await deleteTeam(deleted._id)
		await login({ kind: "team", id: deleted._id })
		expect((await get()).status).toBe(404)
	})

	it("denies unreached quests and quests belonging to another season", async () => {
		for (const team of [future, other]) {
			await login({ kind: "team", id: team._id })
			expect((await get()).status).toBe(404)
		}
	})

	it("hides full images unless showFull is enabled, even after solving", async () => {
		for (const team of [current, solved]) {
			await login({ kind: "team", id: team._id })
			expect((await get("full")).status).toBe(404)
		}
		await showFull(true)
		const response = await get("full")
		expect(response.status).toBe(200)
		expect(await sharp(Buffer.from(await response.arrayBuffer())).metadata()).toMatchObject({ width: 120, height: 80 })
	})

	it("lets admins fetch hidden puzzles and full images regardless of showFull", async () => {
		await login({ kind: "admin", id: adminId })
		expect((await get()).status).toBe(200)
		expect((await get("full")).status).toBe(200)
		expect((await get("full", "hidden")).status).toBe(200)
	})

	it("serves unsaved preview dimensions only to admins, never through team query overrides", async () => {
		const previewIds = await pieceIds("puzzle", assetPath, 3, 2, sessionOptions().password)
		const query = new URLSearchParams({ assetPath, rows: "3", cols: "2" })
		const piece = previewIds[0]
		if (!piece) throw new Error("Missing preview piece")
		const request = () =>
			GET(new Request(`http://localhost/api/puzzle/puzzle/${previewIds[0]}?${query}`), {
				params: Promise.resolve({ questId: "puzzle", piece }),
			})
		await login({ kind: "admin", id: adminId })
		const response = await request()
		expect(response.status).toBe(200)
		expect(await sharp(Buffer.from(await response.arrayBuffer())).metadata()).toMatchObject({ width: 60, height: 26 })
		await login({ kind: "team", id: current._id })
		expect((await request()).status).toBe(404)
	})

	it.each(["0", "unknown-piece", "../full", "..%2Ffull", "full.webp", "/assets/original.png"])(
		"rejects unknown or traversal piece %s",
		async (piece) => {
			await login({ kind: "team", id: current._id })
			expect((await get(piece)).status).toBe(404)
		},
	)

	it("returns 404 for missing quests", async () => {
		await login({ kind: "admin", id: adminId })
		expect((await get("full", "missing")).status).toBe(404)
	})
})
