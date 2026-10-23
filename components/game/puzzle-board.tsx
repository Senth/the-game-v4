"use client"

import { type CSSProperties, type PointerEvent, useId, useRef, useState } from "react"
import type { PlayerPuzzle } from "@/lib/domain/game"
import { dropPiece, snapCell } from "@/lib/domain/puzzle"
import type { Spot } from "@/lib/domain/schemas"

type Drag = {
	id: string
	pointerId: number
	x: number
	y: number
	offsetX: number
	offsetY: number
	width: number
	height: number
}

export function PuzzleBoard({
	questId,
	puzzle,
	preview = false,
	onDrop,
	complete,
}: {
	questId: string
	puzzle: PlayerPuzzle
	preview?: boolean
	onDrop?: (pieceId: string, target: Spot) => Promise<void>
	complete?: number
}) {
	const frame = useRef<HTMLDivElement>(null)
	const tray = useRef<HTMLDivElement>(null)
	const dialog = useRef<HTMLDialogElement>(null)
	const titleId = useId()
	const [previous, setPrevious] = useState(puzzle)
	const [pieces, setPieces] = useState(puzzle.pieces)
	const [drag, setDrag] = useState<Drag | null>(null)
	const [saving, setSaving] = useState(false)
	const [failed, setFailed] = useState(false)
	const latest = useRef(puzzle)
	latest.current = puzzle
	if (previous !== puzzle) {
		setPrevious(puzzle)
		setPieces(puzzle.pieces)
	}
	const inert = preview || complete !== undefined
	const { rows, cols } = puzzle

	function targetAt(x: number, y: number, lifted: Drag): Spot {
		const bounds = frame.current?.getBoundingClientRect()
		const loose = tray.current?.getBoundingClientRect()
		const centerX = x - lifted.offsetX + lifted.width / 2
		const centerY = y - lifted.offsetY + lifted.height / 2
		if (
			bounds &&
			centerX >= bounds.left &&
			centerX <= bounds.right &&
			centerY >= bounds.top &&
			centerY <= bounds.bottom
		)
			return snapCell(rows, cols, (centerX - bounds.left) / bounds.width, (centerY - bounds.top) / bounds.height)
		const clamp = (value: number) => Math.max(0, Math.min(1, value))
		return {
			x: clamp(loose ? (centerX - loose.left - lifted.width / 2) / (loose.width - lifted.width) : 0),
			y: clamp(loose ? (centerY - loose.top - lifted.height / 2) / (loose.height - lifted.height) : 0),
		}
	}

	function lift(event: PointerEvent<HTMLDivElement>) {
		if (inert || saving || drag || !onDrop || !event.isPrimary || event.button !== 0) return
		const element = (event.target as HTMLElement).closest<HTMLElement>("[data-piece]")
		const id = element?.dataset.piece
		if (!id || !element) return
		const bounds = element.getBoundingClientRect()
		event.currentTarget.setPointerCapture(event.pointerId)
		setFailed(false)
		setDrag({
			id,
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			offsetX: event.clientX - bounds.left,
			offsetY: event.clientY - bounds.top,
			width: bounds.width,
			height: bounds.height,
		})
	}

	async function drop(event: PointerEvent<HTMLDivElement>) {
		if (!drag || drag.pointerId !== event.pointerId) return
		const target = targetAt(event.clientX, event.clientY, drag)
		setDrag(null)
		setSaving(true)
		const next = dropPiece(
			{ version: 0, spots: pieces.map((piece) => piece.spot) },
			pieces.findIndex((piece) => piece.id === drag.id),
			target,
		)
		setPieces(pieces.map((piece, index) => ({ ...piece, spot: next.spots[index] as Spot })))
		try {
			await onDrop?.(drag.id, target)
		} catch {
			setPieces(latest.current.pieces)
			setFailed(true)
		} finally {
			setSaving(false)
		}
	}

	const cellStyle = (cell: number): CSSProperties => ({
		left: `${((cell % cols) / cols) * 100}%`,
		top: `${(Math.floor(cell / cols) / rows) * 100}%`,
		width: `${100 / cols}%`,
		height: `${100 / rows}%`,
	})
	function pieceElement(piece: PlayerPuzzle["pieces"][number]) {
		const lifted = drag?.id === piece.id ? drag : null
		const style: CSSProperties = lifted
			? {
					position: "fixed",
					left: lifted.x - lifted.offsetX,
					top: lifted.y - lifted.offsetY,
					width: lifted.width,
					height: lifted.height,
				}
			: "cell" in piece.spot
				? cellStyle(piece.spot.cell)
				: {
						left: `${piece.spot.x * (1 - 1 / cols) * 100}%`,
						top: `${piece.spot.y * (1 - 1 / rows) * 100}%`,
						width: `${100 / cols}%`,
						height: `${100 / rows}%`,
					}
		return (
			<div
				key={piece.id}
				data-piece={piece.id}
				role="img"
				aria-label="Puzzle piece"
				className={`absolute bg-cover ${lifted ? "z-30 ring-2 ring-accent shadow-2xl motion-safe:scale-110 cursor-grabbing" : "cell" in piece.spot ? "" : "rounded-sm shadow-md"} ${!inert && !saving ? "cursor-grab" : ""}`}
				style={{ ...style, backgroundImage: `url("/api/puzzle/${questId}/${piece.id}${puzzle.tileQuery ?? ""}")` }}
			/>
		)
	}
	const target = drag ? targetAt(drag.x, drag.y, drag) : null
	return (
		<div
			style={{ "--puzzle-aspect": puzzle.aspect } as CSSProperties}
			className="mx-auto w-full lg:max-w-[calc((100dvh-var(--spacing)*64)*var(--puzzle-aspect)/2)]"
		>
			{puzzle.fullUrl && (
				<>
					<button
						type="button"
						disabled={preview}
						onClick={() => dialog.current?.showModal()}
						className="mb-3 flex min-h-11 items-center gap-3 font-cond text-sm text-link hover:underline focus-visible:outline-2 focus-visible:outline-accent active:text-head disabled:cursor-default"
					>
						<span
							className="block h-16 w-24 rounded-md bg-cover bg-center"
							style={{ backgroundImage: `url("${puzzle.fullUrl}")` }}
						/>
						Full picture ›
					</button>
					<dialog
						ref={dialog}
						aria-labelledby={titleId}
						onPointerDown={(event) => {
							if (event.target === event.currentTarget) event.currentTarget.close()
						}}
						className="m-auto w-[calc(100%-var(--spacing)*12)] max-w-2xl rounded-md bg-z1 p-5 text-ink backdrop:bg-z0/60"
					>
						<h2 id={titleId} className="mb-4 font-head text-lg font-medium text-head">
							Full picture
						</h2>
						<div
							role="img"
							aria-label="Full picture"
							className="max-h-[70vh] bg-contain bg-center bg-no-repeat"
							style={{ aspectRatio: puzzle.aspect, backgroundImage: `url("${puzzle.fullUrl}")` }}
						/>
						<button
							type="button"
							onClick={() => dialog.current?.close()}
							className="mt-2 min-h-11 px-3 font-cond text-sm text-link hover:underline focus-visible:outline-2 focus-visible:outline-accent active:text-head"
						>
							Close
						</button>
					</dialog>
				</>
			)}
			<div
				role="application"
				aria-label="Puzzle board"
				inert={inert}
				className={`relative grid select-none gap-2 ${preview ? "" : "touch-none"}`}
				onPointerDown={lift}
				onPointerMove={(event) => {
					if (drag?.pointerId === event.pointerId) setDrag({ ...drag, x: event.clientX, y: event.clientY })
				}}
				onPointerUp={drop}
				onPointerCancel={() => setDrag(null)}
				onLostPointerCapture={() => setDrag(null)}
			>
				<div
					className={`rounded-md border-4 border-z2 bg-field shadow-inner ${complete !== undefined ? "ring-2 ring-pace-ok" : ""}`}
				>
					<div ref={frame} className="relative" style={{ aspectRatio: puzzle.aspect }}>
						{complete === undefined &&
							pieces.map((piece, cell) => (
								<div
									key={piece.id}
									className="pointer-events-none absolute border border-z1/50"
									style={cellStyle(cell)}
								/>
							))}
						{pieces.filter((piece) => "cell" in piece.spot).map(pieceElement)}
						{target && "cell" in target && (
							<div
								className="pointer-events-none absolute border-2 border-dashed border-accent bg-accent/15"
								style={cellStyle(target.cell)}
							/>
						)}
					</div>
				</div>
				<div ref={tray} className="relative rounded-md bg-z1/50" style={{ aspectRatio: puzzle.aspect }}>
					{pieces.filter((piece) => !("cell" in piece.spot)).map(pieceElement)}
				</div>
			</div>
			<p
				aria-live="polite"
				className={`mt-2 font-cond text-xs ${complete === undefined ? "text-muted" : "text-pace-ok"}`}
			>
				{complete === undefined
					? "Drag pieces into the frame. They snap to the nearest spot."
					: `Puzzle complete · ${complete >= 0 ? "+" : ""}${complete}p`}
			</p>
			{failed && (
				<p role="alert" className="mt-2 font-cond text-xs text-warn">
					Could not move piece. Try again.
				</p>
			)}
		</div>
	)
}
