"use client"

import { isValidElement, type ReactNode, useEffect, useState } from "react"
import Markdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import type { BundledLanguage, ThemedToken } from "shiki"
import type { PlayerQuest } from "@/lib/domain/game"

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

export function QuestContent({ quest }: { quest: Pick<PlayerQuest, "displayTitle" | "assetPath" | "content"> }) {
	const pdf = quest.assetPath?.toLowerCase().endsWith(".pdf")
	return (
		<section>
			<h1 className="mb-4 font-head text-2xl font-medium text-head">{quest.displayTitle}</h1>
			{quest.assetPath &&
				(pdf ? (
					<a
						href={quest.assetPath}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex min-h-11 items-center font-cond text-sm text-link hover:underline focus-visible:outline-2 focus-visible:outline-link active:text-head"
					>
						Open PDF
					</a>
				) : (
					// biome-ignore lint/performance/noImgElement: Authored assets have no stored dimensions and must retain their intrinsic aspect ratio.
					<img
						src={quest.assetPath}
						alt={quest.displayTitle}
						className="h-auto max-h-[70vh] w-full rounded-md object-contain"
					/>
				))}
			<div
				className={`${quest.assetPath ? "mt-4 " : ""}break-words leading-relaxed [&_p+p]:mt-3 [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-field [&_pre]:p-3 [&_pre]:text-sm [&_pre:focus-visible]:outline-2 [&_pre:focus-visible]:outline-link [&_img]:h-auto [&_img]:max-h-[70vh] [&_img]:max-w-full [&_img]:rounded-md [&_img]:object-contain [&_a]:text-link [&_a:hover]:underline [&_h1]:font-head [&_h1]:text-2xl [&_h1]:text-head [&_h2]:mt-5 [&_h2]:font-head [&_h2]:text-xl [&_h2]:text-head [&_h3]:mt-4 [&_h3]:font-head [&_h3]:text-lg [&_h3]:text-head [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-z2 [&_blockquote]:pl-4 [&_blockquote]:text-muted`}
			>
				<Markdown rehypePlugins={[rehypeRaw]} components={{ pre: CodeFence }}>
					{quest.content}
				</Markdown>
			</div>
		</section>
	)
}
