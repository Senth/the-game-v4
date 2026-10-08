import type { Metadata } from "next"
import Link from "next/link"
import { AuthFrame } from "@/components/auth-frame"
import { redirectSignedIn } from "@/lib/auth/guards"
import { listSeasons } from "@/lib/db/seasons"
import { registrationSeason } from "@/lib/domain/game"
import { LoginForm } from "./login-form"

export const metadata: Metadata = { title: "Log in · The Game" }

export default async function LoginPage() {
	await redirectSignedIn()
	const open = registrationSeason(await listSeasons(), new Date())
	return (
		<AuthFrame>
			<LoginForm />
			{open && (
				<p className="mt-5 text-center font-cond text-sm text-muted">
					New team?{" "}
					<Link href="/register" className="inline-flex min-h-11 items-center text-link hover:underline">
						Create one
					</Link>
				</p>
			)}
		</AuthFrame>
	)
}
