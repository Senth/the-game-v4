"use server"

import { requireAdmin } from "@/lib/auth/guards"
import { type NominatimSearchResult, searchNominatim } from "@/lib/geocode/nominatim"

export async function searchPlaces(query: string): Promise<NominatimSearchResult> {
	await requireAdmin()
	if (typeof query !== "string") return { ok: false, error: "invalid-query" }
	const trimmed = query.trim()
	if (trimmed.length < 2 || trimmed.length > 200) return { ok: false, error: "invalid-query" }
	return searchNominatim(trimmed)
}
