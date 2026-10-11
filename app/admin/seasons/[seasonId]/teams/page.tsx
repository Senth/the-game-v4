import { requireAdmin } from "@/lib/auth/guards"

export default async function TeamsPage() {
	await requireAdmin()
	return <h2 className="px-4 py-5 font-head text-2xl text-head lg:px-8 lg:py-6">Teams</h2>
}
