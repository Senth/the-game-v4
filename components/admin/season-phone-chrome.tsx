"use client"

import { useSelectedLayoutSegment } from "next/navigation"
import type { ReactNode } from "react"

export function SeasonPhoneChrome({ children }: { children: ReactNode }) {
	return useSelectedLayoutSegment() === "quests" ? null : children
}
