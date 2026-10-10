"use client"

import Image from "next/image"
import { useEffect, useRef, useState } from "react"

const qrStorageKey = "the-game-qr"

export function storedQrShown(): boolean {
	try {
		return localStorage.getItem(qrStorageKey) !== "hidden"
	} catch {
		return true
	}
}

export function TeamQrControls({ url, svg }: { url: string; svg: string }) {
	const [shown, setShown] = useState(true)
	const [copied, setCopied] = useState(false)
	const [copyFailed, setCopyFailed] = useState(false)
	const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		setShown(storedQrShown())
		return () => {
			if (copyTimer.current !== null) clearTimeout(copyTimer.current)
		}
	}, [])

	async function copy() {
		setCopyFailed(false)
		try {
			await navigator.clipboard.writeText(url)
			setCopied(true)
			if (copyTimer.current !== null) clearTimeout(copyTimer.current)
			copyTimer.current = setTimeout(() => setCopied(false), 2000)
		} catch {
			setCopied(false)
			setCopyFailed(true)
		}
	}

	function toggle() {
		setShown(!shown)
		try {
			localStorage.setItem(qrStorageKey, shown ? "hidden" : "shown")
		} catch {}
	}

	return (
		<section className="flex flex-col items-center">
			{shown && (
				<>
					<Image
						src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
						alt="QR code to log in to your team"
						width={224}
						height={224}
						className="size-56 overflow-hidden rounded-md"
					/>
					<p className="mt-3 font-cond text-sm text-muted">Teammates scan this to log in.</p>
					<button
						type="button"
						onClick={copy}
						className="mt-5 h-11 w-full max-w-sm rounded-md border border-z2 font-cond font-medium text-link hover:bg-z1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:bg-z2"
					>
						<span aria-live="polite">{copied ? "Copied" : "Copy link"}</span>
					</button>
					{copyFailed && (
						<p role="alert" className="mt-2 font-cond text-sm text-warn">
							Could not copy. Try again.
						</p>
					)}
				</>
			)}
			<button
				type="button"
				onClick={toggle}
				aria-expanded={shown}
				className={`${shown ? "mt-2 " : ""}min-h-11 px-3 font-cond text-sm text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:text-ink`}
			>
				{shown ? "Hide QR code" : "Show QR code"}
			</button>
		</section>
	)
}
