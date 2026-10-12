import { notFound } from "next/navigation"
import { AutosaveTextField } from "@/components/admin/autosave-text-field"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason } from "@/lib/db/seasons"

export default async function SettingsPage({ params }: PageProps<"/admin/seasons/[seasonId]/settings">) {
	await requireAdmin()
	const { seasonId } = await params
	const season = await getSeason(seasonId)
	if (!season) notFound()
	return (
		<div className="space-y-5 px-4 py-5 lg:px-8 lg:py-6">
			<h2 className="font-head text-2xl text-head">Season settings</h2>
			<AutosaveTextField label="Title" target={{ field: "title" }} serverValue={season.title} />
		</div>
	)
}
