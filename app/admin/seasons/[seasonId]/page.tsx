import { requireAdmin } from "@/lib/auth/guards"

export default async function SeasonPage() {
	await requireAdmin()
	return (
		<div className="hidden h-full items-center justify-center px-4 lg:flex">
			<p className="font-cond text-sm text-muted">Pick a quest in the tree.</p>
		</div>
	)
}
