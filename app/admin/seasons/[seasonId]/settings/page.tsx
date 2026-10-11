import { requireAdmin } from "@/lib/auth/guards"

export default async function SettingsPage() {
	await requireAdmin()
	return <h2 className="px-4 py-5 font-head text-2xl text-head lg:px-8 lg:py-6">Season settings</h2>
}
