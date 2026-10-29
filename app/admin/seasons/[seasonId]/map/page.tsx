import { notFound } from "next/navigation"
import { LiveMap } from "@/components/admin/live-map"
import { requireAdmin } from "@/lib/auth/guards"
import { getSeason } from "@/lib/db/seasons"
import { seasonStatus } from "@/lib/domain/admin-seasons"

export default async function MapPage({ params }: PageProps<"/admin/seasons/[seasonId]/map">) {
	await requireAdmin()
	const { seasonId } = await params
	const season = await getSeason(seasonId)
	if (!season) notFound()
	const status = seasonStatus(season, new Date())
	return (
		<div className="flex h-full min-h-0 flex-col">
			<h2 className="mb-4 hidden shrink-0 truncate px-4 pt-6 font-head text-2xl text-head lg:block">Map</h2>
			<LiveMap key={status} seasonId={seasonId} />
		</div>
	)
}
