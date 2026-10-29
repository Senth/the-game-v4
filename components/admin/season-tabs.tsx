"use client"

import Link from "next/link"
import { useSelectedLayoutSegment } from "next/navigation"

export function SeasonTabs({ seasonId }: { seasonId: string }) {
	const segment = useSelectedLayoutSegment()
	return (
		<nav aria-label="Season sections" className="flex border-b border-z1 font-cond text-sm">
			{[
				{ title: "Quests", segment: null },
				{ title: "Teams", segment: "teams" },
				{ title: "Map", segment: "map" },
				{ title: "Settings", segment: "settings" },
			].map((tab) => (
				<Link
					key={tab.title}
					href={`/admin/seasons/${seasonId}${tab.segment ? `/${tab.segment}` : ""}`}
					aria-current={segment === tab.segment ? "page" : undefined}
					className={`flex min-h-11 min-w-0 flex-1 items-center justify-center border-b-2 px-3 hover:text-head active:text-head focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${segment === tab.segment ? "border-accent text-head" : "border-transparent text-muted"}`}
				>
					{tab.title}
				</Link>
			))}
		</nav>
	)
}

export function SeasonMenuLinks({ seasonId, teamCount }: { seasonId: string; teamCount: number }) {
	const segment = useSelectedLayoutSegment()
	return (
		<ul>
			{[
				{ title: "Season settings", segment: "settings" },
				{ title: "Teams", segment: "teams" },
				{ title: "Map", segment: "map" },
			].map((entry) => (
				<li key={entry.segment}>
					<Link
						href={`/admin/seasons/${seasonId}/${entry.segment}`}
						aria-current={segment === entry.segment ? "page" : undefined}
						className={`flex min-h-11 items-center justify-between px-3 pr-4 text-sm hover:text-head active:text-head focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${segment === entry.segment ? "text-head" : "text-muted"}`}
					>
						{entry.title}
						{entry.segment === "teams" && <span>{teamCount}</span>}
					</Link>
				</li>
			))}
		</ul>
	)
}
