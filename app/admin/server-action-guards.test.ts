import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const publicActions = new Set([
	"app/board/actions.ts:getBoard",
	"app/login/actions.ts:login",
	"app/register/actions.ts:register",
])

function unguardedActions(filename: string, text: string): string[] {
	const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true)
	const directives = source.statements.slice(
		0,
		source.statements.findIndex((node) => !ts.isExpressionStatement(node) || !ts.isStringLiteral(node.expression)),
	)
	if (
		!directives.some(
			(node) => ts.isExpressionStatement(node) && node.expression.getText(source).slice(1, -1) === "use server",
		)
	)
		return []

	const guards = new Set<string>()
	const functions = new Map<string, ts.Node>()
	const actions = new Map<string, string>()
	const violations: string[] = []
	for (const node of source.statements) {
		if (
			ts.isImportDeclaration(node) &&
			ts.isStringLiteral(node.moduleSpecifier) &&
			node.moduleSpecifier.text === "@/lib/auth/guards"
		) {
			const bindings = node.importClause?.namedBindings
			if (!node.importClause?.isTypeOnly && bindings && ts.isNamedImports(bindings)) {
				for (const binding of bindings.elements) {
					if (
						!binding.isTypeOnly &&
						["requireAdmin", "requireTeam"].includes((binding.propertyName ?? binding.name).text)
					)
						guards.add(binding.name.text)
				}
			}
		}
		const exported =
			ts.canHaveModifiers(node) &&
			ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
		if (ts.isFunctionDeclaration(node) && node.name && node.body) {
			functions.set(node.name.text, node.body)
			if (exported) actions.set(node.name.text, node.name.text)
		} else if (ts.isVariableStatement(node)) {
			for (const declaration of node.declarationList.declarations) {
				if (ts.isIdentifier(declaration.name) && declaration.initializer) {
					const value = declaration.initializer
					functions.set(
						declaration.name.text,
						ts.isArrowFunction(value) || ts.isFunctionExpression(value) ? value.body : value,
					)
					if (exported) actions.set(declaration.name.text, declaration.name.text)
				} else if (exported) {
					violations.push(`${filename}: unchecked export`)
				}
			}
		} else if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
			if (!node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)) {
				for (const item of node.exportClause.elements)
					if (!item.isTypeOnly) actions.set(item.name.text, (item.propertyName ?? item.name).text)
			} else violations.push(`${filename}: unchecked re-export`)
		} else if (ts.isExportAssignment(node)) {
			functions.set("default", node.expression)
			actions.set("default", "default")
		} else if (exported && !ts.isTypeAliasDeclaration(node) && !ts.isInterfaceDeclaration(node)) {
			violations.push(`${filename}: unchecked export`)
		}
	}

	function guarded(name: string, seen = new Set<string>()): boolean {
		const body = functions.get(name)
		if (!body || seen.has(name)) return false
		seen.add(name)
		function visit(node: ts.Node): boolean {
			if (ts.isFunctionLike(node)) return false
			if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
				if (guards.has(node.expression.text) || guarded(node.expression.text, seen)) return true
			}
			return ts.forEachChild(node, visit) ?? false
		}
		return visit(body)
	}

	for (const [name, local] of actions) {
		const action = `${filename}:${name}`
		if (!publicActions.has(action) && !guarded(local)) violations.push(action)
	}
	return violations
}

describe("server action guards", () => {
	it("guards every tracked app server action except the explicit public allowlist", () => {
		const files = execFileSync("git", ["ls-files", "-z", "--", "app/*.ts", "app/*.tsx"], { encoding: "utf8" })
			.split("\0")
			.filter(Boolean)
		expect(files).toContain("app/actions.ts")
		expect(files.flatMap((filename) => unguardedActions(filename, readFileSync(filename, "utf8")))).toEqual([])
	})

	it.each(["app/actions.ts", "app/admin/new-actions.ts", "app/admin/new-actions.tsx", "app/board/actions.ts"])(
		"rejects a new unguarded export in %s even beside a guarded action",
		(filename) => {
			expect(
				unguardedActions(
					filename,
					`"use server";
import { requireAdmin } from "@/lib/auth/guards";
export async function safe() { await requireAdmin() }
export async function unsafe() { return "unguarded" }
`,
				),
			).toEqual([`${filename}:unsafe`])
		},
	)

	it("follows a local wrapper and an aliased guard without treating strings or nested functions as guards", () => {
		expect(
			unguardedActions(
				"app/admin/actions.tsx",
				`'use server';
import { requireAdmin as admin } from "@/lib/auth/guards";
async function wrapper() { await admin() }
export const safe = async () => wrapper();
export async function unsafe() {
  const text = "requireAdmin()";
  async function unused() { await admin() }
}
`,
			),
		).toEqual(["app/admin/actions.tsx:unsafe"])
	})
})
