const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&*@$"

export function scrambleFrame(target: string, progress: number, random: () => number): string {
	const characters = Array.from(target)
	const locked = Math.floor(Math.max(0, Math.min(1, progress)) * characters.length)
	return characters
		.map((character, index) => {
			if (index < locked || character === " ") return character
			const glyphIndex = Math.min(Math.floor(Math.max(0, random()) * GLYPHS.length), GLYPHS.length - 1)
			const glyph = GLYPHS[glyphIndex] ?? GLYPHS[0]
			return glyph === character ? (GLYPHS[(glyphIndex + 1) % GLYPHS.length] ?? glyph) : glyph
		})
		.join("")
}
