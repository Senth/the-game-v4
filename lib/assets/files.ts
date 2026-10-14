import { randomUUID } from "node:crypto"
import { mkdir, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { contentTypes, type detectAssetExtension } from "@/lib/domain/assets"

const assetName = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp|pdf)$/i

export function assetsDir(): string {
	return path.resolve(process.env.ASSETS_DIR ?? ".tmp/assets")
}

export function resolveAssetFile(file: string) {
	const match = assetName.exec(file)
	if (!match) return null

	const extension = match[1]?.toLowerCase() as keyof typeof contentTypes | undefined
	if (!extension) return null
	return {
		path: path.resolve(assetsDir(), file),
		contentType: contentTypes[extension],
	}
}

export async function saveAsset(
	bytes: Uint8Array,
	extension: NonNullable<ReturnType<typeof detectAssetExtension>>,
): Promise<string> {
	const directory = assetsDir()
	await mkdir(directory, { recursive: true })
	const filename = `${randomUUID()}.${extension}`
	const assetPath = `/assets/${filename}`
	try {
		await writeFile(path.join(directory, filename), bytes)
	} catch (error) {
		await deleteAssetFile(assetPath)
		throw error
	}
	return assetPath
}

export async function deleteAssetFile(assetPath: string): Promise<void> {
	const asset = resolveAssetFile(path.basename(assetPath))
	if (!asset) return
	try {
		await unlink(asset.path)
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
	}
}
