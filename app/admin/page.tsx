import { AdminFrame } from "@/components/admin/admin-frame"
import { NewSeasonForm } from "@/components/admin/new-season-form"
import { SeasonList } from "@/components/admin/season-list"
import { SeasonMenu } from "@/components/admin/season-menu"
import { LogOutButton } from "@/components/log-out-button"
import { requireAdmin } from "@/lib/auth/guards"
import { listSeasons } from "@/lib/db/seasons"

export default async function AdminPage() {
	await requireAdmin()
	const seasons = await listSeasons()
	const now = Date.now()
	return (
		<AdminFrame
			title="Seasons"
			menu={<SeasonMenu seasons={seasons} now={now} />}
			phoneHeader={
				<NewSeasonForm variant="header">
					<h1 className="font-head text-lg text-head">Seasons</h1>
					<div className="ml-auto">
						<LogOutButton />
					</div>
				</NewSeasonForm>
			}
		>
			<div className="lg:hidden">
				<SeasonList seasons={seasons} now={now} />
			</div>
			<div className="hidden h-full items-center justify-center px-4 lg:flex">
				<p className="font-cond text-sm text-muted">
					{seasons.length ? "Pick a season, or create one." : "No seasons yet."}
				</p>
			</div>
		</AdminFrame>
	)
}
