import { randomUUID } from "node:crypto"
import { mkdir, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { assetExtensionPattern } from "@/lib/domain/assets"

const assetName = new RegExp(`^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\\.${assetExtensionPattern}$`, "i")

export function assetsDir(): string {
	return path.resolve(/* turbopackIgnore: true */ process.env.ASSETS_DIR ?? ".tmp/assets")
}

export function resolveAssetFile(file: string) {
	const match = assetName.exec(file)
	if (!match) return null

	return {
		path: path.resolve(assetsDir(), file),
	}
}

export async function saveAsset(bytes: Uint8Array, extension: string): Promise<string> {
	if (!new RegExp(`^${assetExtensionPattern}$`, "i").test(extension)) throw new Error("Invalid asset extension")
	const directory = assetsDir()
	await mkdir(directory, { recursive: true })
	const filename = `${randomUUID()}.${extension.toLowerCase()}`
	const assetPath = `/assets/${filename}`
	try {
		await writeFile(path.join(/* turbopackIgnore: true */ directory, filename), bytes)
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
