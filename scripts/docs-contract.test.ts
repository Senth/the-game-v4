import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const lineCaps: Record<string, number> = {
	"docs/PROJECT.md": 60,
	"docs/TESTS.md": 25,
}

function violationsFor(path: string, content: string) {
	const lines = content.split(/\r?\n/)
	if (content.endsWith("\n")) lines.pop()
	return lines.flatMap((line, index) =>
		index >= (lineCaps[path] ?? lines.length) ||
		/\bI-\d+\b|#\d+\b|\/(issues|pull)\/\d+|\b(issue|pull request|PR) #?\d+\b/i.test(line)
			? [`${path}:${index + 1}: ${line}`]
			: [],
	)
}

describe("docs contract", () => {
	it("keeps tracked Markdown free of task references and within line caps", () => {
		const paths = execFileSync("git", ["ls-files", "*.md"], { encoding: "utf8" }).trim().split("\n")
		const violations = paths.flatMap((path) => violationsFor(path, readFileSync(join(process.cwd(), path), "utf8")))
		expect(violations).toEqual([])
	})

	it.each([
		"I-35",
		"i-35",
		"#35",
		"https://github.com/owner/repo/issues/35",
		"https://github.com/owner/repo/pull/35",
		"ISSUE 35",
		"pull request 35",
		"PR 35",
		"issue #35",
	])("reports file and line for %s", (reference) => {
		expect(violationsFor("example.md", `# Example\r\n${reference}\r\n`)).toEqual([`example.md:2: ${reference}`])
	})

	it.each(Object.entries(lineCaps))("enforces the line cap for %s", (path, cap) => {
		const content = "text\n".repeat(cap)
		expect(violationsFor(path, content)).toEqual([])
		expect(violationsFor(path, `${content}extra\n`)).toEqual([`${path}:${cap + 1}: extra`])
	})
})
