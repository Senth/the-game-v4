import { isAssetReferenced } from "@/lib/db/seasons"
import { deleteAssetFile } from "./files"

export async function releaseAsset(assetPath: string | null): Promise<void> {
	if (assetPath !== null && !(await isAssetReferenced(assetPath))) await deleteAssetFile(assetPath)
}
