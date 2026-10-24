"use client"

import dynamic from "next/dynamic"
import { isValidElement, type ReactNode, useEffect, useState } from "react"
import Markdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import type { BundledLanguage, ThemedToken } from "shiki"
import { assetExtension, assetKind } from "@/lib/domain/assets"
import type { PlayerQuest } from "@/lib/domain/game"
import type { Spot } from "@/lib/domain/schemas"
import { AudioBar } from "./audio-bar"
import { PuzzleBoard } from "./puzzle-board"

const PlaceMap = dynamic(() => import("./place-map").then((module) => module.PlaceMap), {
	ssr: false,
	loading: () => <div className="aspect-[4/3] w-full rounded-md bg-z1" role="img" aria-label="Loading map" />,
})

function CodeFence({ children }: { children?: ReactNode }) {
	const element = isValidElement<{ children?: ReactNode; className?: string }>(children) ? children : null
	const code = element?.type === "code" && typeof element.props.children === "string" ? element.props.children : null
	const language = element?.props.className?.match(/language-([^\s]+)/)?.[1] ?? "text"
	const [highlighted, setHighlighted] = useState<{ code: string; language: string; tokens: ThemedToken[][] } | null>(
		null,
	)

	useEffect(() => {
		if (code === null) return
		const source = code
		let cancelled = false
		async function highlight() {
			try {
				const { codeToTokens, bundledLanguages } = await import("shiki")
				const { tokens } = await codeToTokens(source, {
					lang: Object.hasOwn(bundledLanguages, language) ? (language as BundledLanguage) : "text",
					theme: {
						name: "game",
						colors: { "editor.background": "var(--color-field)", "editor.foreground": "var(--color-ink)" },
						settings: [
							{ scope: ["keyword", "storage"], settings: { foreground: "var(--color-link)" } },
							{ scope: "comment", settings: { foreground: "var(--color-muted)" } },
							{ scope: ["constant", "entity.name.function"], settings: { foreground: "var(--color-head)" } },
						],
					},
				})
				if (!cancelled) setHighlighted({ code: source, language, tokens })
			} catch {
				if (!cancelled) setHighlighted(null)
			}
		}
		void highlight()
		return () => {
			cancelled = true
		}
	}, [code, language])

	if (highlighted?.code === code && highlighted.language === language) {
		return (
			<pre>
				<code>
					{highlighted.tokens.flatMap((line, index) => [
						index > 0 ? "\n" : "",
						...line.map((token) => (
							<span key={token.offset} style={{ color: token.color }}>
								{token.content}
							</span>
						)),
					])}
				</code>
			</pre>
		)
	}
	return <pre>{children}</pre>
}

export function QuestContent({
	quest,
	preview = false,
	position,
	onPuzzleDrop,
	puzzleComplete,
}: {
	quest: Pick<PlayerQuest, "displayTitle" | "assetPath" | "content"> &
		Partial<Pick<PlayerQuest, "id" | "puzzle" | "location">>
	preview?: boolean
	position?: { lat: number; lng: number; accuracy: number }
	onPuzzleDrop?: (pieceId: string, target: Spot) => Promise<void>
	puzzleComplete?: number
}) {
	const kind = quest.assetPath ? assetKind(quest.assetPath) : null
	const extension = quest.assetPath ? assetExtension(quest.assetPath) : "bin"
	const place = quest.location?.guidance === "map" ? quest.location.places[0] : undefined
	const AssetLink = preview ? "span" : "a"
	return (
		<section inert={preview}>
			{quest.displayTitle.trim() && (
				<h1 className="mb-4 font-head text-2xl font-medium text-head">{quest.displayTitle}</h1>
			)}
			{quest.puzzle && quest.id && (
				<PuzzleBoard
					key={quest.id}
					questId={quest.id}
					puzzle={quest.puzzle}
					preview={preview}
					onDrop={onPuzzleDrop}
					complete={puzzleComplete}
				/>
			)}
			{quest.assetPath &&
				(kind === "pdf" ? (
					<AssetLink
						href={preview ? undefined : quest.assetPath}
						target={preview ? undefined : "_blank"}
						rel={preview ? undefined : "noopener noreferrer"}
						className="inline-flex min-h-11 items-center font-cond text-sm text-link hover:underline focus-visible:outline-2 focus-visible:outline-link active:text-head"
					>
						Open PDF
					</AssetLink>
				) : kind === "audio" ? (
					<AudioBar key={quest.assetPath} src={quest.assetPath} />
				) : kind === "video" ? (
					// biome-ignore lint/a11y/useMediaCaption: Authored puzzle assets have no caption track.
					<video src={quest.assetPath} controls preload="metadata" className="max-h-[70vh] w-full rounded-md" />
				) : kind === "file" ? (
					<AssetLink
						href={preview ? undefined : quest.assetPath}
						download={preview ? undefined : true}
						className="flex h-11 w-full items-center justify-center rounded-md border border-z2 px-3 font-cond text-sm text-head hover:bg-z1 focus-visible:outline-2 focus-visible:outline-link active:bg-z2"
					>
						↓ Download {extension === "bin" ? "file" : extension.toUpperCase()}
					</AssetLink>
				) : (
					// biome-ignore lint/performance/noImgElement: Authored assets have no stored dimensions and must retain their intrinsic aspect ratio.
					<img
						src={quest.assetPath}
						alt={quest.displayTitle}
						className="h-auto max-h-[70vh] w-full rounded-md object-contain"
					/>
				))}
			{place && <PlaceMap key={quest.id} place={place} position={position} preview={preview} />}
			<div
				className={`${quest.assetPath || quest.puzzle || place ? "mt-4 " : ""}break-words leading-relaxed [&_p+p]:mt-3 [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-field [&_pre]:p-3 [&_pre]:text-sm [&_pre:focus-visible]:outline-2 [&_pre:focus-visible]:outline-link [&_img]:h-auto [&_img]:max-h-[70vh] [&_img]:max-w-full [&_img]:rounded-md [&_img]:object-contain [&_a]:text-link [&_a:hover]:underline [&_h1]:font-head [&_h1]:text-2xl [&_h1]:text-head [&_h2]:mt-5 [&_h2]:font-head [&_h2]:text-xl [&_h2]:text-head [&_h3]:mt-4 [&_h3]:font-head [&_h3]:text-lg [&_h3]:text-head [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-z2 [&_blockquote]:pl-4 [&_blockquote]:text-muted`}
			>
				<Markdown
					rehypePlugins={[rehypeRaw]}
					components={{
						pre: CodeFence,
						a: preview ? ({ children }) => <span className="text-link">{children}</span> : undefined,
					}}
				>
					{quest.content}
				</Markdown>
			</div>
		</section>
	)
}
