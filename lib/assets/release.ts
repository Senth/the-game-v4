import { isAssetReferenced } from "@/lib/db/seasons"
import { deleteAssetFile } from "./files"
import { deletePuzzleTiles } from "./puzzle-tiles"

const cache = globalThis as typeof globalThis & { theGameAssetReferences?: Promise<void> }

// ponytail: single-container reference gate; use per-asset locks if copy contention grows.
export async function withAssetReferences<T>(work: () => Promise<T>): Promise<T> {
	const previous = cache.theGameAssetReferences
	const next = Promise.withResolvers<void>()
	cache.theGameAssetReferences = next.promise
	await previous
	try {
		return await work()
	} finally {
		next.resolve()
		if (cache.theGameAssetReferences === next.promise) delete cache.theGameAssetReferences
	}
}

export async function releaseAsset(assetPath: string | null): Promise<void> {
	if (assetPath === null) return
	await withAssetReferences(async () => {
		if (!(await isAssetReferenced(assetPath))) {
			await deleteAssetFile(assetPath)
			await deletePuzzleTiles(assetPath)
		}
	})
}
