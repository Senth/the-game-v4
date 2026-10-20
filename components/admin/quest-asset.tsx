"use client"

import Image from "next/image"
import { type Ref, useImperativeHandle, useRef, useState } from "react"
import { removeQuestAsset, uploadQuestAsset } from "@/app/admin/asset-actions"
import { labelClass } from "@/components/auth-form"
import { assetFileError } from "@/lib/domain/assets"
import { ConfirmDialog, outlineClass } from "./confirm-dialog"

export type QuestAssetHandle = {
	upload: (file: File) => Promise<void>
	setError: (error: string) => void
}

export function QuestAsset({
	seasonId,
	arcId,
	questId,
	assetPath,
	onChange,
	ref,
}: {
	seasonId: string
	arcId: string
	questId: string
	assetPath: string | null
	onChange: (assetPath: string | null) => void
	ref?: Ref<QuestAssetHandle>
}) {
	const input = useRef<HTMLInputElement>(null)
	const busy = useRef(false)
	const [pending, setPending] = useState<"upload" | "remove" | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [confirming, setConfirming] = useState(false)
	const filename = assetPath?.split("/").pop() ?? ""
	const extension = filename.slice(filename.lastIndexOf("."))
	const shortName = filename.slice(0, filename.lastIndexOf(".")).slice(0, 8) + extension
	const pdf = extension.toLowerCase() === ".pdf"

	async function upload(file: File) {
		if (busy.current || confirming) return
		const invalid = assetFileError(file)
		setError(invalid)
		if (invalid) return
		busy.current = true
		setPending("upload")
		try {
			const data = new FormData()
			data.set("file", file)
			const result = await uploadQuestAsset(seasonId, arcId, questId, data)
			if (result.ok) onChange(result.assetPath)
			else setError(result.error)
		} catch {
			setError("Not saved, retry")
		} finally {
			busy.current = false
			setPending(null)
		}
	}

	useImperativeHandle(ref, () => ({ upload, setError }))

	async function remove() {
		if (busy.current || !assetPath) return
		busy.current = true
		setPending("remove")
		setConfirming(false)
		setError(null)
		try {
			const result = await removeQuestAsset(seasonId, arcId, questId)
			if (result.ok) onChange(null)
			else setError(result.error)
		} catch {
			setError("Not saved, retry")
		} finally {
			busy.current = false
			setPending(null)
		}
	}

	return (
		<div>
			<span className={labelClass}>
				Image
				{!assetPath && (
					<span className="ml-2 font-body normal-case tracking-normal">jpg, png, gif, webp or pdf, up to 10 MB</span>
				)}
			</span>
			<input
				ref={input}
				type="file"
				className="hidden"
				aria-label="Upload quest image or PDF"
				disabled={pending !== null}
				onChange={(event) => {
					const file = event.currentTarget.files?.[0]
					event.currentTarget.value = ""
					if (file) void upload(file)
				}}
			/>
			<div className="flex min-w-0 items-center gap-3">
				{!assetPath ? (
					<span className="flex h-14 w-20 shrink-0 items-center justify-center rounded-md border border-dashed border-z2 font-cond text-xl text-muted">
						+
					</span>
				) : pdf ? (
					<span className="flex h-14 w-20 shrink-0 items-center justify-center rounded-md bg-z1 font-cond text-sm text-muted">
						PDF
					</span>
				) : (
					<Image
						src={assetPath}
						alt=""
						width={80}
						height={56}
						unoptimized
						className="h-14 w-20 shrink-0 rounded-md object-cover"
					/>
				)}
				<span className="min-w-0 flex-1 truncate font-cond text-sm text-muted">
					{assetPath ? shortName : "No image"}
				</span>
				<button
					type="button"
					className={`${outlineClass.replace("text-ink", "text-head")} shrink-0 border-z2`}
					disabled={pending !== null}
					onClick={() => input.current?.click()}
				>
					{pending === "upload" ? "Uploading…" : assetPath ? "Replace" : "Upload"}
				</button>
				{assetPath && (
					<button
						type="button"
						className="h-11 shrink-0 px-2 font-cond text-sm text-muted hover:underline active:text-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
						disabled={pending !== null}
						onClick={() => setConfirming(true)}
					>
						Remove
					</button>
				)}
			</div>
			{error && (
				<p role="alert" className="mt-1.5 font-cond text-xs text-warn">
					{error}
				</p>
			)}
			<ConfirmDialog
				open={confirming}
				title={pdf ? "Remove this PDF?" : "Remove this image?"}
				body="Players stop seeing it and the file is deleted."
				confirmLabel={pdf ? "Remove PDF" : "Remove image"}
				disabled={pending !== null}
				onConfirm={() => void remove()}
				onClose={() => setConfirming(false)}
			/>
		</div>
	)
}
