"use client"

import { useSelectedLayoutSegments } from "next/navigation"
import type { ReactNode } from "react"

export function SeasonPhoneChrome({ children }: { children: ReactNode }) {
	const [section, detail] = useSelectedLayoutSegments()
	return section === "quests" || (section === "teams" && detail) ? null : children
}
