import Image from "next/image"
import { labelClass } from "@/components/auth-form"

export function QuestAsset({ assetPath }: { assetPath: string | null }) {
	if (!assetPath) return null
	const filename = assetPath.split("/").pop() ?? ""
	const extension = filename.slice(filename.lastIndexOf("."))
	const shortName = filename.slice(0, filename.lastIndexOf(".")).slice(0, 8) + extension
	return (
		<div>
			<span className={labelClass}>Image</span>
			<div className="flex min-w-0 items-center gap-3">
				{extension.toLowerCase() === ".pdf" ? (
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
				<span className="truncate font-cond text-sm text-muted">{shortName}</span>
			</div>
		</div>
	)
}
