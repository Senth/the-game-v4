import { LogOutButton } from "@/components/log-out-button"
import { requireTeam } from "@/lib/auth/guards"

export default async function Home() {
	await requireTeam()
	return (
		<main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
			<h1 className="font-head text-3xl font-medium text-head">The Game</h1>
			<p className="text-muted">Nothing to play yet.</p>
			<LogOutButton />
		</main>
	)
}
