export function teamColor(index: number, count: number): string {
	return `hsl(${(index * 360) / count} 75% ${count > 10 && index % 2 === 1 ? 78 : 72}%)`
}
