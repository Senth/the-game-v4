"use client"

import { useRef, useState } from "react"
import { formatTimeLeft } from "./clock"

export function AudioBar({ src }: { src: string }) {
	const audio = useRef<HTMLAudioElement>(null)
	const [playing, setPlaying] = useState(false)
	const [duration, setDuration] = useState(0)
	const [time, setTime] = useState(0)

	async function toggle() {
		if (!audio.current) return
		if (!audio.current.paused) {
			audio.current.pause()
			return
		}
		try {
			await audio.current.play()
		} catch {
			setPlaying(false)
		}
	}

	return (
		<div className="flex items-center gap-3 rounded-md bg-field px-3 py-2">
			{/* biome-ignore lint/a11y/useMediaCaption: Authored puzzle assets have no caption track. */}
			<audio
				ref={audio}
				src={src}
				preload="metadata"
				hidden
				onLoadedMetadata={(event) => {
					const value = event.currentTarget.duration
					setDuration(Number.isFinite(value) && value > 0 ? value : 0)
				}}
				onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
				onPlay={() => setPlaying(true)}
				onPause={() => setPlaying(false)}
				onEnded={() => setPlaying(false)}
			/>
			<button
				type="button"
				aria-label={playing ? "Pause audio" : "Play audio"}
				onClick={toggle}
				className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-head hover:bg-accent/80 focus-visible:outline-2 focus-visible:outline-link active:bg-accent/70"
			>
				<span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
			</button>
			<div className="relative flex h-11 min-w-0 flex-1 items-center">
				<span aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-z2">
					<span
						className="block h-full rounded-full bg-accent"
						style={{ width: `${duration ? (time / duration) * 100 : 0}%` }}
					/>
				</span>
				<input
					type="range"
					aria-label="Seek audio"
					aria-valuetext={`${formatTimeLeft(time * 1000)} / ${formatTimeLeft(duration * 1000)}`}
					min={0}
					max={duration}
					step={1}
					value={time}
					disabled={!duration}
					onChange={(event) => {
						if (!audio.current) return
						const value = Number(event.currentTarget.value)
						audio.current.currentTime = value
						setTime(value)
					}}
					className="absolute inset-0 h-11 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-2 focus-visible:outline-link disabled:cursor-default [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-accent [&::-moz-range-track]:bg-transparent [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
				/>
			</div>
			<span className="shrink-0 font-cond text-sm text-muted tabular-nums">
				{formatTimeLeft(time * 1000)} / {formatTimeLeft(duration * 1000)}
			</span>
		</div>
	)
}
