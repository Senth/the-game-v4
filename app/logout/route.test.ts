import { expect, it } from "vitest"
import * as route from "./route"

it("exports only POST so links and prefetches cannot log a user out", () => {
	expect(Object.keys(route)).toEqual(["POST"])
	expect(route.POST).toBeTypeOf("function")
})
