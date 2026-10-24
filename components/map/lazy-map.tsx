"use client"

import dynamic from "next/dynamic"

const LazyMap = dynamic(() => import("./map-view"), {
	ssr: false,
	loading: () => <div className="aspect-[16/10] w-full rounded-md bg-z1" role="img" aria-label="Loading map" />,
})

export default LazyMap
