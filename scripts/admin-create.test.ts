import { describe, expect, it } from "vitest"
import { verifyPassword } from "@/lib/auth/password"
import { getAdminByName } from "@/lib/db/admins"
import { useTestDb } from "@/test/db"
import { createAdminAccount } from "./admin-create"

useTestDb()

describe("createAdminAccount", () => {
	it("stores a bcrypt hash of the password", async () => {
		await createAdminAccount("gm", "longpassword")

		const admin = await getAdminByName("gm")
		expect(admin?.passwordHash).toMatch(/^\$2[aby]\$10\$/)
		expect(await verifyPassword("longpassword", admin?.passwordHash ?? "")).toBe(true)
	})

	it("rejects a taken name", async () => {
		await createAdminAccount("taken", "longpassword")
		await expect(createAdminAccount("taken", "otherpassword")).rejects.toThrow('Admin "taken" already exists')
	})

	it("rejects a password under 8 characters", async () => {
		await expect(createAdminAccount("short", "1234567")).rejects.toThrow("Password must be at least 8 characters")
		expect(await getAdminByName("short")).toBeNull()
	})
})
