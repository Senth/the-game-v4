"use client"

import { type ReactNode, useEffect, useState } from "react"

export function BoardStage({ children }: { children: ReactNode }) {
	const [scale, setScale] = useState(1)
	useEffect(() => {
		const resize = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080))
		resize()
		window.addEventListener("resize", resize)
		return () => window.removeEventListener("resize", resize)
	}, [])
	return (
		<div className="fixed inset-0 flex items-center justify-center overflow-hidden bg-z0">
			<div className="w-[1920px] h-[1080px] shrink-0 origin-center" style={{ transform: `scale(${scale})` }}>
				{children}
			</div>
		</div>
	)
}
