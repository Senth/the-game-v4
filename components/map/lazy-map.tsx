"use client"

import dynamic from "next/dynamic"
import type { MapViewProps } from "./map-view"

const DynamicMap = dynamic<MapViewProps>(() => import("./map-view"), {
	ssr: false,
	loading: () => <div className="h-full w-full rounded-md bg-z1" role="img" aria-label="Loading map" />,
})

export default function LazyMap({ aspectRatio = "16/10", ...props }: MapViewProps) {
	const aspect = aspectRatio === "4/3" ? "aspect-[4/3]" : "aspect-[16/10]"
	return (
		<div className={`${aspect} w-full`}>
			<DynamicMap {...props} aspectRatio={aspectRatio} />
		</div>
	)
}
