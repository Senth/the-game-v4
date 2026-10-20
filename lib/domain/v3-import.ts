import { z } from "zod"
import { normalizeAnswer } from "./game"
import { Season } from "./schemas"

const V3Timestamp = z
	.union([
		z.iso.datetime({ offset: true }),
		z.object({ _seconds: z.number() }),
		z.object({ seconds: z.number() }),
		z.object({ __datatype__: z.literal("timestamp"), value: z.object({ _seconds: z.number() }) }),
	])
	.transform((value) => {
		if (typeof value === "string") return new Date(value)
		const seconds = "value" in value ? value.value._seconds : "_seconds" in value ? value._seconds : value.seconds
		return new Date(seconds * 1000)
	})
	.pipe(z.date())
	.nullable()
	.optional()

const V3Quest = z.object({
	id: z.string().optional(),
	title: z.string().default(""),
	description: z.string().default(""),
	displayTitle: z.string().default(""),
	content: z.string().default(""),
	code: z.string().optional(),
	answer: z.string().default(""),
	points: z.unknown(),
	asset: z.string().optional(),
	imageUrl: z.string().optional(),
	hints: z.array(z.object({ text: z.string().default(""), points: z.unknown().optional() })).default([]),
})

const V3Season = z.object({
	title: z.string(),
	length: z.number().default(60),
	start: V3Timestamp,
	end: V3Timestamp,
	order: z.enum(["Ordered", "Random All", "Random Theme", "Random Quest"]).default("Ordered"),
	themes: z.array(z.object({ title: z.string(), random: z.boolean().default(false), quests: z.array(V3Quest) })),
})

export type V3AssetJob = { url: string; target: "assetPath" | "content" }

export function parseV3Export(input: unknown): {
	season: Season
	assetJobs: Record<string, V3AssetJob[]>
	warnings: string[]
}[] {
	const collections = Object.entries(z.record(z.string(), z.unknown()).parse(input)).filter(
		([key]) => key !== "__collections__",
	)
	if (collections.length !== 1) throw new Error("V3 export must contain exactly one collection")
	const documents = z.record(z.string(), z.unknown()).parse(collections[0]?.[1])
	return Object.entries(documents)
		.filter(([key]) => key !== "__collections__")
		.map(([_id, document]) => {
			const source = V3Season.parse(document)
			const warnings: string[] = []
			const assetJobs: Record<string, V3AssetJob[]> = {}
			const start = source.start ?? null
			const season = Season.parse({
				_id,
				title: source.title,
				lengthMinutes: source.length,
				start,
				end: source.end ?? (start ? new Date(start.getTime() + source.length * 60_000) : null),
				registrationOpen: false,
				shuffleArcs: source.order === "Random All" || source.order === "Random Theme",
				arcs: source.themes.map((theme) => ({
					id: crypto.randomUUID(),
					title: theme.title,
					shuffleQuests: theme.random,
					quests: theme.quests.map((quest, index) => {
						const id = crypto.randomUUID()
						const label = quest.title || quest.displayTitle || quest.id || `quest ${index + 1}`
						const context = `Season ${JSON.stringify(source.title)} (${_id}), arc ${JSON.stringify(theme.title)}, quest ${JSON.stringify(label)}`
						const warn = (message: string) => warnings.push(`${context}: ${message}`)
						const answers: string[] = []
						const seen = new Set<string>()
						for (const part of quest.answer.split("|")) {
							const answer = part.trim().normalize("NFC")
							if (answer.length > 200) {
								warn("dropped answer longer than 200 characters")
							} else if (answer && !seen.has(normalizeAnswer(answer))) {
								answers.push(answer)
								seen.add(normalizeAnswer(answer))
							}
						}
						const points =
							typeof quest.points === "number" &&
							Number.isInteger(quest.points) &&
							quest.points >= 0 &&
							quest.points <= 10000
								? quest.points
								: null
						if (points === null) warn(`invalid quest points ${String(quest.points)}; using null`)
						let content = quest.content
						if (quest.code && content) {
							const fence = "`".repeat(
								(content.match(/`+/g) ?? []).reduce((length, run) => Math.max(length, run.length + 1), 3),
							)
							content = `${fence}${quest.code}\n${content}\n${fence}`
						}
						const asset = quest.asset || quest.imageUrl
						if (asset) assetJobs[id] = [{ url: asset, target: "assetPath" }]
						if (quest.asset && quest.imageUrl) {
							assetJobs[id]?.push({ url: quest.imageUrl, target: "content" })
							warn("imageUrl will be appended to content as a Markdown image because asset is also set")
						}
						return {
							id,
							internalTitle: quest.title,
							adminNotes: quest.description,
							displayTitle: quest.displayTitle,
							content,
							assetPath: null,
							answers,
							points,
							hints: quest.hints
								.filter((hint) => hint.text.trim())
								.map((hint) => {
									const original = hint.points
									const validNumber = typeof original === "number" && Number.isFinite(original)
									const points = validNumber ? Math.min(10000, Math.max(0, original)) : 0
									if (!validNumber) warn(`invalid hint points ${String(original)}; using 0`)
									else if (points !== original) warn(`clamped hint points ${original} to ${points}`)
									return { id: crypto.randomUUID(), text: hint.text, points }
								}),
						}
					}),
				})),
			})
			return { season, assetJobs, warnings }
		})
}
