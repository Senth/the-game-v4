import Link from "next/link"
import { AutosaveHeader, SaveStatus } from "./save-status"

export function QuestHeader({
	seasonId,
	arcTitle,
	label,
}: {
	seasonId: string
	arcTitle: string
	label: string | null
}) {
	return (
		<div className="lg:hidden">
			<AutosaveHeader className="flex min-h-12 items-center border-b px-1 font-cond">
				<Link
					href={`/admin/seasons/${seasonId}`}
					className="flex min-h-11 min-w-0 max-w-40 items-center px-3 text-link hover:underline active:text-head focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
				>
					<span className="truncate">‹ {arcTitle.trim() || "Untitled arc"}</span>
				</Link>
				<h1 className={`min-w-0 flex-1 truncate pr-4 font-head ${label ? "text-head" : "text-muted"}`}>
					{label ?? "Untitled quest"}
				</h1>
				<div className="shrink-0 pr-3">
					<SaveStatus />
				</div>
			</AutosaveHeader>
		</div>
	)
}
