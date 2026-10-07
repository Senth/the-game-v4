import { LogOutButton } from "@/components/log-out-button"
import { requireAdmin } from "@/lib/auth/guards"

export default async function AdminPage() {
	await requireAdmin()
	return (
		<main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
			<h1 className="font-head text-3xl font-medium text-head">Admin</h1>
			<LogOutButton />
		</main>
	)
}
