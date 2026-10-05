import { describe, expect, it } from "vitest"
import { useTestDb } from "@/test/db"
import { createAdmin, getAdmin, getAdminByName } from "./admins"

useTestDb()

describe("admins", () => {
	it("creates an admin and finds it by id and by name", async () => {
		const admin = await createAdmin({ name: "admin", passwordHash: "$2b$10$hash" })

		expect(await getAdmin(admin._id)).toEqual(admin)
		expect(await getAdminByName("admin")).toEqual(admin)
		expect(await getAdminByName("nobody")).toBeNull()
	})
})
