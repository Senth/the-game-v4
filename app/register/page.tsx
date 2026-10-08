import type { Metadata } from "next"
import Link from "next/link"
import { AuthFrame } from "@/components/auth-frame"
import { redirectSignedIn } from "@/lib/auth/guards"
import { listSeasons } from "@/lib/db/seasons"
import { registrationSeason } from "@/lib/domain/game"
import { RegisterForm } from "./register-form"

export const metadata: Metadata = { title: "Create team · The Game" }

export default async function RegisterPage() {
	await redirectSignedIn()
	const season = registrationSeason(await listSeasons(), new Date())
	return (
		<AuthFrame
			subtitle={
				season && (
					<>
						New team for <span className="text-ink">{season.title}</span>
					</>
				)
			}
		>
			{season ? (
				<RegisterForm />
			) : (
				<div className="text-center">
					<p className="text-ink">Registration is closed right now.</p>
					<p className="mt-2 font-cond text-sm text-muted">Ask a game master to open it.</p>
				</div>
			)}
			<p className="mt-5 text-center font-cond text-sm text-muted">
				Have a team?{" "}
				<Link href="/login" className="inline-flex min-h-11 items-center text-link hover:underline">
					Log in
				</Link>
			</p>
		</AuthFrame>
	)
}
