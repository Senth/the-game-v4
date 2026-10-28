import { beforeEach, describe, expect, it, vi } from "vitest"
import { useTestDb } from "@/test/db"
import { collections } from "./collections"
import { deleteTeamPhones, ensurePhone, listTeamPhones, removePhone, renamePhone, touchPhone } from "./phones"

useTestDb()
const now = new Date("2026-10-28T17:00:00Z")
const firstId = crypto.randomUUID()
const secondId = crypto.randomUUID()

beforeEach(async () => {
	vi.restoreAllMocks()
	await (await collections()).phones.deleteMany({})
})

describe("phones", () => {
	it("creates separate team/phone records and reuses existing identity unchanged", async () => {
		const first = await ensurePhone("team", firstId, now)
		expect(first.created).toBe(true)
		expect(first.phone).toMatchObject({ teamId: "team", phoneId: firstId, createdAt: now, lastSeenAt: now })
		const second = await ensurePhone("team", secondId, now)
		expect(second.phone.name).not.toBe(first.phone.name)
		const other = await ensurePhone("other", firstId, now)
		expect(other.created).toBe(true)
		expect(other.phone._id).not.toBe(first.phone._id)
		expect(await renamePhone("other", firstId, first.phone.name)).toMatchObject({ ok: true })
		expect(await ensurePhone("team", firstId, new Date(now.getTime() + 1000))).toEqual({ ...first, created: false })
		expect(await listTeamPhones("team")).toHaveLength(2)
	})

	it("enforces both unique indexes independently of repository writes", async () => {
		const { phone } = await ensurePhone("team", firstId, now)
		const { phones } = await collections()
		await expect(phones.insertOne({ ...phone, _id: "duplicate-identity", name: "Fresh Fox" })).rejects.toMatchObject({
			code: 11000,
		})
		await expect(
			phones.insertOne({ ...phone, _id: "duplicate-name", phoneId: secondId, name: phone.name.toLowerCase() }),
		).rejects.toMatchObject({ code: 11000 })
	})

	it("normalizes renames, rejects duplicates ignoring case and generates names for empty saves", async () => {
		await ensurePhone("team", firstId, now)
		await ensurePhone("team", secondId, now)
		expect(await renamePhone("team", firstId, "  Keen Owl  ")).toMatchObject({ ok: true, phone: { name: "Keen Owl" } })
		expect(await renamePhone("team", secondId, "keen owl")).toEqual({ ok: false, error: "taken" })
		expect(await renamePhone("team", firstId, "KEEN OWL")).toMatchObject({ ok: true, phone: { name: "KEEN OWL" } })
		const renamed = await renamePhone("team", firstId, "   ")
		expect(renamed).toMatchObject({ ok: true })
		if (renamed.ok) expect(renamed.phone.name).not.toBe("KEEN OWL")
		await expect(renamePhone("team", firstId, "x".repeat(21))).rejects.toThrow()
		await expect(renamePhone("team", "missing", "Keen Owl")).rejects.toThrow("Phone missing not found")
	})

	it("retries a concurrent random-name race and creates only once for the same identity", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0)
		const results = await Promise.all([
			ensurePhone("team", firstId, now),
			ensurePhone("team", secondId, now),
			ensurePhone("team", firstId, now),
		])
		expect(results.filter((result) => result.created)).toHaveLength(2)
		const phones = await listTeamPhones("team")
		expect(phones).toHaveLength(2)
		expect(new Set(phones.map((phone) => phone.name)).size).toBe(2)
	})

	it("rejects concurrent explicit duplicates and retries concurrent empty renames", async () => {
		await ensurePhone("team", firstId, now)
		await ensurePhone("team", secondId, now)
		const results = await Promise.all([
			renamePhone("team", firstId, "Quiet Fox"),
			renamePhone("team", secondId, "quiet fox"),
		])
		expect(results.map((result) => result.ok).sort()).toEqual([false, true])
		vi.spyOn(Math, "random").mockReturnValue(0)
		expect(
			(await Promise.all([renamePhone("team", firstId, ""), renamePhone("team", secondId, "")])).every(
				(result) => result.ok,
			),
		).toBe(true)
		expect(new Set((await listTeamPhones("team")).map((phone) => phone.name)).size).toBe(2)
	})

	it("touches only at the 60-second boundary and never moves time backwards", async () => {
		const { phone } = await ensurePhone("team", firstId, now)
		await touchPhone("team", firstId, new Date(now.getTime() + 59_999))
		expect(await listTeamPhones("team")).toEqual([phone])
		const later = new Date(now.getTime() + 60_000)
		await touchPhone("team", firstId, later)
		await touchPhone("team", firstId, now)
		expect(await listTeamPhones("team")).toEqual([{ ...phone, lastSeenAt: later }])
	})

	it("removes only the requested team/phone and deletes all phones of one team", async () => {
		await ensurePhone("team", firstId, now)
		await ensurePhone("team", secondId, now)
		const other = await ensurePhone("other", firstId, now)
		await removePhone("team", firstId)
		expect((await listTeamPhones("team")).map((phone) => phone.phoneId)).toEqual([secondId])
		await deleteTeamPhones("team")
		expect(await listTeamPhones("team")).toEqual([])
		expect(await listTeamPhones("other")).toEqual([other.phone])
	})
})
