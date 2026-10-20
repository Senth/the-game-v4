import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { useAutosaveField } from "./autosave-provider"
import { FinisherBonusRows } from "./finisher-bonus-rows"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("./autosave-provider", () => ({ useAutosave: () => null, useAutosaveField: vi.fn() }))

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(useAutosaveField).mockImplementation((_target, value) => ({
		value,
		onChange: vi.fn(),
		onBlur: vi.fn(),
		onFocus: vi.fn(),
		failed: false,
		error: undefined,
	}))
})

it("shows empty copy and Add place without a Save bar", () => {
	const html = renderToStaticMarkup(
		<FinisherBonusRows season={{ _id: "s", finisherBonuses: [], finishers: [] }} teams={[]} />,
	)
	expect(html).toContain("No bonus")
	expect(html).toContain("+ Add place")
	expect(html).toContain("Points for the first teams to finish. Row 1 is first place.")
	expect(html).not.toContain("<input")
})

it("quiets claimed rows, freezes awarded points and only removes last unclaimed place", () => {
	const html = renderToStaticMarkup(
		<FinisherBonusRows
			season={{
				_id: "s",
				finisherBonuses: [50, 20, 10],
				finishers: [{ teamId: "t", place: 1, points: 0, at: new Date() }],
			}}
			teams={[{ _id: "t", name: "Ninjas" }]}
		/>,
	)
	expect(html).toContain("Ninjas")
	expect(html).toContain('aria-label="Finished"')
	expect(html).not.toContain('aria-label="1st place points"')
	expect(html).not.toContain('aria-label="Remove 2nd place"')
	expect(html).toContain('aria-label="Remove 3rd place"')
	expect(useAutosaveField).toHaveBeenCalledWith({ field: "finisherBonuses", index: "1" }, 20)
	expect(useAutosaveField).toHaveBeenCalledWith({ field: "finisherBonuses", index: "2" }, 10)
})

it("never offers removal for a claimed last row and handles deleted winners", () => {
	const html = renderToStaticMarkup(
		<FinisherBonusRows
			season={{
				_id: "s",
				finisherBonuses: [50],
				finishers: [{ teamId: "gone", place: 1, points: 50, at: new Date() }],
			}}
			teams={[]}
		/>,
	)
	expect(html).toContain("Deleted team")
	expect(html).not.toContain("✕")
	expect(html).not.toContain("<input")
})

it("shows rejected autosaves as warn lines", () => {
	vi.mocked(useAutosaveField).mockReturnValue({
		value: 20,
		onChange: vi.fn(),
		onBlur: vi.fn(),
		onFocus: vi.fn(),
		failed: true,
		error: "Already won, can't change",
	})
	const html = renderToStaticMarkup(
		<FinisherBonusRows season={{ _id: "s", finisherBonuses: [20], finishers: [] }} teams={[]} />,
	)
	expect(html).toContain("text-warn")
	expect(html).toContain("Already won, can&#x27;t change")
	expect(html).toContain('aria-invalid="true"')
})
