import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("design contract", () => {
	it("contains only app-wide rules", () => {
		const content = readFileSync(join(process.cwd(), "docs/DESIGN.md"), "utf8")
		const lines = content.split(/\r?\n/)
		if (content.endsWith("\n")) lines.pop()

		const violations = new Set<string>()
		const addViolation = (index: number) => violations.add(`line ${index + 1}: ${lines[index]}`)

		for (let index = 200; index < lines.length; index += 1) addViolation(index)

		let inDecisions = false
		let decisionContentColumn = -1
		let decisionStart = -1
		let decisionHasContested = false
		const finishDecision = () => {
			if (decisionStart !== -1 && !decisionHasContested) addViolation(decisionStart)
			decisionStart = -1
			decisionHasContested = false
		}

		lines.forEach((line, index) => {
			if (/^#{1,2}\s/.test(line)) {
				finishDecision()
				inDecisions = /^##\s+Decisions\s*$/.test(line)
				decisionContentColumn = -1
			} else if (inDecisions && /^#{3,6}\s/.test(line)) {
				finishDecision()
				decisionContentColumn = -1
			}

			const bullet = inDecisions && /^ {0,3}[-*+]\s/.test(line)
			if (bullet) {
				const indentation = line.search(/\S/)
				if (decisionContentColumn === -1 || indentation < decisionContentColumn) {
					finishDecision()
					decisionStart = index
					decisionContentColumn = indentation + 2
				}
			}
			if (decisionStart !== -1 && line.includes("Contested:")) {
				decisionHasContested = true
			}

			if (
				/(^|[\s(])#\d+\b/.test(line) ||
				/\.tmp\/|artifacts\.senth\.org/.test(line) ||
				/(?:#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b)/.test(line.replace(/\]\(#[^)]*\)/g, "")) ||
				/\b(?:later|planned|not yet|known drift|follow-up)\b/i.test(line) ||
				/\bTODO\b/.test(line)
			) {
				addViolation(index)
			}
		})

		finishDecision()
		expect([...violations]).toEqual([])
	})
})
