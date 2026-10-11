import bcrypt from "bcryptjs"
import { expect, it } from "vitest"
import { hashPassword, verifyPassword } from "./password"

it("verifies the right password and rejects a wrong one", async () => {
	const hash = await hashPassword("ninjas")

	expect(bcrypt.getRounds(hash)).toBe(10)
	expect(hash).not.toContain("ninjas")
	expect(await verifyPassword("ninjas", hash)).toBe(true)
	expect(await verifyPassword("Ninjas", hash)).toBe(false)
})
