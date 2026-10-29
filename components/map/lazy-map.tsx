"use client"

import dynamic from "next/dynamic"
import type { MapViewProps } from "./map-view"

const DynamicMap = dynamic<MapViewProps>(() => import("./map-view"), {
	ssr: false,
	loading: () => <div className="h-full w-full rounded-md bg-z1" role="img" aria-label="Loading map" />,
})

export default function LazyMap({ aspectRatio = "16/10", fill = false, ...props }: MapViewProps) {
	const sizing = fill ? "h-full min-h-0 w-full" : `${aspectRatio === "4/3" ? "aspect-[4/3]" : "aspect-[16/10]"} w-full`
	return (
		<div className={sizing}>
			<DynamicMap {...props} aspectRatio={aspectRatio} fill={fill} />
		</div>
	)
}
