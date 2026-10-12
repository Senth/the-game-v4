"use server"

import { redirect } from "next/navigation"
import { requireAdmin } from "@/lib/auth/guards"
import { createSeason } from "@/lib/db/seasons"
import { NewSeasonTitle } from "@/lib/domain/admin-seasons"

export type CreateSeasonState = { error?: string }

export async function createSeasonAction(_prev: CreateSeasonState, formData: FormData): Promise<CreateSeasonState> {
	await requireAdmin()
	const title = NewSeasonTitle.safeParse(formData.get("title"))
	if (!title.success) return { error: "Season titles are 1 to 60 characters." }
	const season = await createSeason({
		title: title.data,
		lengthMinutes: 60,
		start: null,
		end: null,
		shuffleArcs: false,
		arcs: [],
	})
	redirect(`/admin/seasons/${season._id}`)
}
