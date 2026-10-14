import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { redirect } from "next/navigation"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { saveAsset } from "@/lib/assets/files"
import * as assets from "@/lib/assets/release"
import { requireAdmin } from "@/lib/auth/guards"
import { collections } from "@/lib/db/collections"
import * as seasons from "@/lib/db/seasons"
import { maxAssetBytes } from "@/lib/domain/assets"
import { newArc, newQuest } from "@/lib/domain/season-tree"
import { boardChannel, publish, seasonChannel } from "@/lib/events/bus"
import { useTestDb } from "@/test/db"
import { removeQuestAsset, uploadQuestAsset } from "./asset-actions"

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/events/bus", async (original) => ({
	...(await original<typeof import("@/lib/events/bus")>()),
	publish: vi.fn(),
}))

useTestDb()
const ids = ["season", "arc", "quest"] as const
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
let directory: string

beforeEach(async () => {
	vi.restoreAllMocks()
	vi.mocked(requireAdmin).mockReset().mockResolvedValue({ _id: "admin", name: "admin", passwordHash: "hash" })
	vi.mocked(publish).mockClear()
	directory = await mkdtemp(path.resolve(".tmp", "asset-actions-"))
	vi.stubEnv("ASSETS_DIR", directory)
	await (await collections()).seasons.deleteMany({})
	await seasons.createSeason({
		_id: ids[0],
		title: "Cipher Night",
		lengthMinutes: 60,
		start: null,
		end: null,
		shuffleArcs: false,
		arcs: [{ ...newArc(false), id: ids[1], quests: [{ ...newQuest(), id: ids[2] }] }],
	})
})

afterEach(async () => {
	vi.unstubAllEnvs()
	await rm(directory, { recursive: true, force: true })
})

function form(file: File = new File([png], "image.png", { type: "text/plain" })) {
	const data = new FormData()
	data.set("file", file)
	return data
}

async function currentPath() {
	return (await seasons.getSeason(ids[0]))?.arcs[0]?.quests[0]?.assetPath
}

async function attach() {
	const assetPath = await saveAsset(png, "png")
	await seasons.setQuestAsset(...ids, assetPath)
	return assetPath
}

describe("quest asset actions", () => {
	it.each(["upload", "remove"])("rejects non-admin before any %s validation or write", async (action) => {
		vi.mocked(requireAdmin).mockImplementationOnce(async () => redirect("/login"))
		const data = form()
		const read = vi.spyOn(data, "get")
		const write = vi.spyOn(seasons, "setQuestAsset")
		await expect(
			action === "upload" ? uploadQuestAsset("", "", "", data) : removeQuestAsset("", "", ""),
		).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") })
		expect(read).not.toHaveBeenCalled()
		expect(write).not.toHaveBeenCalled()
		expect(await readdir(directory)).toEqual([])
		expect(publish).not.toHaveBeenCalled()
	})

	it.each(["upload", "remove"])("validates every id before %s writes", async (action) => {
		const write = vi.spyOn(seasons, "setQuestAsset")
		for (let index = 0; index < ids.length; index++) {
			for (const invalid of ["", null, 42]) {
				const values: [string, string, string] = [...ids]
				values[index] = invalid as string
				expect(await (action === "upload" ? uploadQuestAsset(...values, form()) : removeQuestAsset(...values))).toEqual(
					{ ok: false, error: "Invalid value." },
				)
			}
		}
		expect(write).not.toHaveBeenCalled()
		expect(await readdir(directory)).toEqual([])
		expect(publish).not.toHaveBeenCalled()
	})

	it.each([null, "not a file"])("rejects file field %j with retry copy", async (value) => {
		const data = new FormData()
		if (value !== null) data.set("file", value)
		expect(await uploadQuestAsset(...ids, data)).toEqual({ ok: false, error: "Not saved, retry" })
		expect(await currentPath()).toBeNull()
		expect(await readdir(directory)).toEqual([])
		expect(publish).not.toHaveBeenCalled()
	})

	it.each([
		[new File(["<svg></svg>"], "image.png", { type: "image/png" }), "image.png is not jpg, png, gif, webp or pdf."],
		[new File([new Uint8Array(maxAssetBytes + 1)], "image.png"), "image.png is 10.0 MB. The limit is 10 MB."],
	])("rejects invalid upload with exact copy: %s", async (file, error) => {
		expect(await uploadQuestAsset(...ids, form(file))).toEqual({ ok: false, error })
		expect(await currentPath()).toBeNull()
		expect(await readdir(directory)).toEqual([])
		expect(publish).not.toHaveBeenCalled()
	})

	it.each([
		["image.png", png, "png"],
		["image.jpeg", new Uint8Array([0xff, 0xd8, 0xff]), "jpg"],
		["image.jpg", png, "png"],
		["image.gif", new TextEncoder().encode("GIF89a"), "gif"],
		["image.webp", new TextEncoder().encode("RIFF1234WEBP"), "webp"],
		["file.pdf", new TextEncoder().encode("%PDF-"), "pdf"],
	])("uploads %s using detected %s bytes, ignoring client MIME", async (name, bytes, extension) => {
		const result = await uploadQuestAsset(...ids, form(new File([bytes], name, { type: "text/plain" })))
		expect(result).toEqual({ ok: true, assetPath: await currentPath() })
		if (!result.ok) throw new Error(result.error)
		expect(result.assetPath).toMatch(new RegExp(`^/assets/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\\.${extension}$`))
		expect(await readFile(path.join(directory, path.basename(result.assetPath)))).toEqual(Buffer.from(bytes))
		expect(vi.mocked(publish).mock.calls).toEqual([[seasonChannel(ids[0])], [boardChannel]])
	})

	it("accepts exactly 10 MB while live", async () => {
		await seasons.setSeasonField(ids[0], { field: "start" }, new Date(Date.now() - 1000))
		const bytes = new Uint8Array(maxAssetBytes)
		bytes.set(png)
		expect((await uploadQuestAsset(...ids, form(new File([bytes], "image.png")))).ok).toBe(true)
	})

	it.each([false, true])("replace releases old file only when unreferenced, shared=%s", async (shared) => {
		const previous = await attach()
		if (shared) {
			const season = await seasons.getSeason(ids[0])
			if (!season) throw new Error("Season missing")
			await seasons.createSeason({ ...season, _id: "other" })
		}
		const result = await uploadQuestAsset(...ids, form())
		expect(result.ok).toBe(true)
		expect(await currentPath()).not.toBe(previous)
		expect((await readdir(directory)).includes(path.basename(previous))).toBe(shared)
		expect(await readdir(directory)).toHaveLength(shared ? 2 : 1)
	})

	it.each([false, true])("remove clears path and releases file only when unreferenced, shared=%s", async (shared) => {
		const previous = await attach()
		if (shared) {
			const season = await seasons.getSeason(ids[0])
			if (!season) throw new Error("Season missing")
			await seasons.createSeason({ ...season, _id: "other" })
		}
		expect(await removeQuestAsset(...ids)).toEqual({ ok: true })
		expect(await currentPath()).toBeNull()
		expect(await readdir(directory)).toEqual(shared ? [path.basename(previous)] : [])
		expect(vi.mocked(publish).mock.calls).toEqual([[seasonChannel(ids[0])], [boardChannel]])
	})

	it("removes a null asset without filesystem work", async () => {
		expect(await removeQuestAsset(...ids)).toEqual({ ok: true })
		expect(await readdir(directory)).toEqual([])
	})

	it.each(["upload", "remove"])("keeps committed %s and publishes when releaseAsset fails", async (action) => {
		const previous = await attach()
		const error = new Error("Asset cleanup unavailable")
		const release = vi.spyOn(assets, "releaseAsset").mockRejectedValueOnce(error)
		const log = vi.spyOn(console, "error").mockImplementation(() => {})
		const result = await (action === "upload" ? uploadQuestAsset(...ids, form()) : removeQuestAsset(...ids))
		expect(result).toEqual(action === "upload" ? { ok: true, assetPath: await currentPath() } : { ok: true })
		if (action === "upload") expect(await currentPath()).not.toBe(previous)
		else expect(await currentPath()).toBeNull()
		expect(release).toHaveBeenCalledExactlyOnceWith(previous)
		expect(log).toHaveBeenCalledExactlyOnceWith("Failed to release asset", previous, error)
		expect((await readdir(directory)).includes(path.basename(previous))).toBe(true)
		expect(vi.mocked(publish).mock.calls).toEqual([[seasonChannel(ids[0])], [boardChannel]])
	})

	it("returns missing quest message and deletes new file without publishing", async () => {
		expect(await uploadQuestAsset(ids[0], ids[1], "missing", form())).toEqual({
			ok: false,
			error: 'Season season has no {"arcId":"arc","questId":"missing","field":"assetPath"}',
		})
		expect(await currentPath()).toBeNull()
		expect(await readdir(directory)).toEqual([])
		expect(publish).not.toHaveBeenCalled()
	})

	it("deletes new file but preserves previous path on unexpected database failure", async () => {
		const previous = await attach()
		const error = new Error("Database unavailable")
		vi.spyOn(seasons, "setQuestAsset").mockRejectedValueOnce(error)
		await expect(uploadQuestAsset(...ids, form())).rejects.toBe(error)
		expect(await currentPath()).toBe(previous)
		expect(await readdir(directory)).toEqual([path.basename(previous)])
		expect(publish).not.toHaveBeenCalled()
	})
})
