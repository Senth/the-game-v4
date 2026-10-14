import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { AnswerChips } from "./answer-chips"
import { createListSaver } from "./autosave"
import { useAutosaveList } from "./autosave-provider"

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }))
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useId: () => "answers",
	useState: (initial: unknown) => {
		const index = hooks.cursor++
		if (!(index in hooks.values)) hooks.values[index] = initial
		return [
			hooks.values[index],
			(next: unknown) => {
				hooks.values[index] = next
			},
		]
	},
}))
vi.mock("./autosave-provider", () => ({ useAutosaveList: vi.fn(() => list) }))

const props = { arcId: "arc", questId: "quest", answers: ["lighthouse", "fyren"] }
const list = { items: [] as string[], add: vi.fn(), remove: vi.fn(), failed: false }
function view() {
	hooks.cursor = 0
	return AnswerChips(props)
}
function input() {
	return view().props.children[1].props.children[1]
}
function type(value: string) {
	input().props.onChange({ target: { value } })
}
function key(key: string, isComposing = false) {
	const preventDefault = vi.fn()
	input().props.onKeyDown({ key, nativeEvent: { isComposing }, preventDefault })
	return preventDefault
}
function paste(text: string) {
	const preventDefault = vi.fn()
	input().props.onPaste({ currentTarget: {}, clipboardData: { getData: () => text }, preventDefault })
	expect(preventDefault).toHaveBeenCalledOnce()
}

beforeEach(() => {
	vi.clearAllMocks()
	hooks.values = []
	list.items = [...props.answers]
	list.failed = false
	list.add.mockImplementation((answer: string) => list.items.push(answer))
	list.remove.mockImplementation((answer: string) => {
		list.items = list.items.filter((item) => item !== answer)
	})
})

it("labels the shared field box, limits input and gives chip removals 44px targets", () => {
	const html = renderToStaticMarkup(view())
	expect(useAutosaveList).toHaveBeenCalledWith({ arcId: "arc", questId: "quest", field: "answers" }, props.answers)
	expect(html).toContain('for="answers"')
	expect(html).toContain("any match, case-insensitive")
	expect(html).toContain('id="answers"')
	expect(html).toContain('placeholder="Add answer" maxLength="200"')
	expect(html).toContain("bg-field")
	expect(html).toContain("focus-within:border-accent")
	expect(html).toContain("rounded bg-z2 pl-2 font-cond text-sm")
	expect(html).toContain('aria-label="Remove answer lighthouse"')
	expect(html).toContain("min-h-11 w-11")
})

it.each(["Enter", ","])("commits trimmed NFC text on %s and clears input", (delimiter) => {
	type("  cafe\u0301  ")
	expect(key(delimiter)).toHaveBeenCalledOnce()
	expect(list.add).toHaveBeenCalledExactlyOnceWith("café")
	expect(input().props.value).toBe("")
})

it("commits text before a typed comma while preserving remaining text", () => {
	type("  keeper , lamp")
	expect(list.add).toHaveBeenCalledExactlyOnceWith("keeper")
	expect(input().props.value).toBe(" lamp")
	input().props.onBlur()
	expect(list.add).toHaveBeenLastCalledWith("lamp")
	expect(input().props.value).toBe("")
})

it.each(["a, b, c", "a\nb\r\nc", " ,a, ,b\n\nc, "])("splits pasted %s into separate non-empty additions", (text) => {
	paste(text)
	expect(list.add.mock.calls).toEqual([["a"], ["b"], ["c"]])
	expect(input().props.value).toBe("")
})

it("uses the input selection when pasting into existing text", () => {
	type("abXXef")
	input().props.onPaste({
		currentTarget: { selectionStart: 2, selectionEnd: 4 },
		clipboardData: { getData: () => "cd" },
		preventDefault: vi.fn(),
	})
	expect(list.add).toHaveBeenCalledExactlyOnceWith("abcdef")
})

it("retains oversized pasted parts with an error without blocking a later valid add", async () => {
	const oversized = "x".repeat(201)
	const patch = vi.fn(async (answer: string) => ({ ok: answer.length <= 200 }))
	const onState = vi.fn()
	const saver = createListSaver({ patch, onState })
	list.add.mockImplementation((answer: string) => {
		list.items.push(answer)
		saver.enqueue(answer)
	})
	paste(`${oversized}, keeper`)
	expect(list.add).toHaveBeenCalledExactlyOnceWith("keeper")
	expect(input().props.value).toBe(oversized)
	const html = renderToStaticMarkup(view())
	expect(html).toContain('aria-invalid="true" aria-describedby="answers-error"')
	expect(html).toContain("border-warn")
	expect(html).toContain('id="answers-error" role="alert"')
	expect(html).toContain("Use 1 to 200 characters per answer.")
	input().props.onBlur()
	expect(list.add).toHaveBeenCalledOnce()
	type("lamp")
	key("Enter")
	await vi.waitFor(() => expect(onState).toHaveBeenLastCalledWith("saved"))
	expect(patch.mock.calls).toEqual([["keeper"], ["lamp"]])
	expect(input().props.value).toBe("")
	expect(renderToStaticMarkup(view())).not.toContain("Use 1 to 200 characters per answer.")
})

it("checks pasted answer length after trim and NFC and accepts 200 characters", () => {
	paste(` ${"a\u030a".repeat(200)} `)
	expect(list.add).toHaveBeenCalledExactlyOnceWith("å".repeat(200))
	expect(input().props.value).toBe("")
})

it("commits on blur and ignores empty commits", () => {
	type(" keeper ")
	input().props.onBlur()
	expect(list.add).toHaveBeenCalledExactlyOnceWith("keeper")
	type("  ")
	key("Enter")
	input().props.onBlur()
	expect(list.add).toHaveBeenCalledOnce()
})

it("removes by chip button or Backspace on empty, not Backspace while typing", () => {
	view().props.children[1].props.children[0][0].props.children[1].props.onClick()
	expect(list.remove).toHaveBeenLastCalledWith("lighthouse")
	type("text")
	expect(key("Backspace")).not.toHaveBeenCalled()
	expect(list.remove).toHaveBeenCalledOnce()
	type("")
	expect(key("Backspace")).toHaveBeenCalledOnce()
	expect(list.remove).toHaveBeenLastCalledWith("fyren")
	expect(key("Backspace")).not.toHaveBeenCalled()
	expect(list.remove).toHaveBeenCalledTimes(2)
})

it.each([" LIGHTHOUSE ", "CAFE\u0301"])(
	"rejects case- and NFC-equivalent duplicate %s and clears notice on next key",
	(answer) => {
		list.items.push("café")
		type(answer)
		key("Enter")
		expect(list.add).not.toHaveBeenCalled()
		expect(input().props.value).toBe("")
		const html = renderToStaticMarkup(view())
		expect(html).toContain('aria-describedby="answers-duplicate"')
		expect(html).toContain('role="status" class="mt-1.5 font-cond text-xs text-muted">Already an answer')
		key("ArrowLeft")
		expect(renderToStaticMarkup(view())).not.toContain("Already an answer")
	},
)

it("deduplicates within a pasted batch and clears notice on next input change", () => {
	paste("cafe\u0301, CAFÉ, lamp")
	expect(list.add.mock.calls).toEqual([["café"], ["lamp"]])
	expect(renderToStaticMarkup(view())).toContain("Already an answer")
	type("next")
	expect(renderToStaticMarkup(view())).not.toContain("Already an answer")
})

it("does not commit Enter during composition", () => {
	type("text")
	expect(key("Enter", true)).not.toHaveBeenCalled()
	expect(list.add).not.toHaveBeenCalled()
	expect(input().props.value).toBe("text")
})

it("keeps optimistic chips visible and marks failed list with warn border and Not saved", () => {
	list.failed = true
	const html = renderToStaticMarkup(view())
	expect(html).toContain("lighthouse")
	expect(html).toContain("border-warn")
	expect(html).toContain("focus-within:border-warn")
	expect(html).not.toContain("border-z2")
	expect(html).toContain('aria-invalid="true" aria-describedby="answers-error"')
	expect(html).toContain('id="answers-error" role="alert"')
	expect(html).toContain("Not saved")
})
