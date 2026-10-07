import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth/session"
import { getAdmin } from "@/lib/db/admins"
import { getTeam } from "@/lib/db/teams"
import { LoginForm } from "./login-form"

export const metadata: Metadata = { title: "Log in · The Game" }

export default async function LoginPage() {
	const { kind, id } = await getSession()
	if (kind === "admin" && id && (await getAdmin(id))) redirect("/admin")
	if (kind === "team" && id && (await getTeam(id))) redirect("/")
	return (
		<main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
			<h1 className="mb-8 font-head text-3xl font-medium text-head">The Game</h1>
			<LoginForm />
			<p className="mt-5 font-cond text-sm text-muted">
				New team?{" "}
				<Link href="/register" className="inline-flex min-h-11 items-center text-link hover:underline">
					Create one
				</Link>
			</p>
		</main>
	)
}
