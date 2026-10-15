import type { Arc, Hint, Quest } from "./schemas"

type KeyboardItem = { kind: "hint"; questId: string; id: string } | { kind: "quest" | "arc"; id: string }

type KeyboardTarget = { toArcId?: string; beforeId: string | null }
type KeyboardModifiers = { altKey: boolean; shiftKey: boolean }

function moveBefore<T extends { id: string }>(items: T[], id: string, beforeId: string | null): T[] {
	const from = items.findIndex((item) => item.id === id)
	if (from < 0 || beforeId === id) return items

	const beforeIndex = beforeId === null ? items.length : items.findIndex((item) => item.id === beforeId)
	if (beforeIndex < 0) return items

	const remaining = items.filter((_, index) => index !== from)
	const to = beforeId === null ? remaining.length : remaining.findIndex((item) => item.id === beforeId)
	if (from === to) return items

	const moved = items[from]
	return moved ? [...remaining.slice(0, to), moved, ...remaining.slice(to)] : items
}

export function moveHint(quest: Quest, hintId: string, beforeId: string | null): Hint[] {
	return moveBefore(quest.hints, hintId, beforeId)
}

export function moveQuest(arcs: Arc[], questId: string, toArcId: string, beforeId: string | null): Arc[] {
	const fromArc = arcs.find((arc) => arc.quests.some((quest) => quest.id === questId))
	const toArc = arcs.find((arc) => arc.id === toArcId)
	if (!fromArc || !toArc) return arcs

	if (fromArc.id === toArc.id) {
		const quests = moveBefore(fromArc.quests, questId, beforeId)
		return quests === fromArc.quests ? arcs : arcs.map((arc) => (arc.id === fromArc.id ? { ...arc, quests } : arc))
	}

	const quest = fromArc.quests.find((item) => item.id === questId)
	if (!quest || (beforeId !== null && !toArc.quests.some((item) => item.id === beforeId))) return arcs

	const fromQuests = fromArc.quests.filter((item) => item.id !== questId)
	const toIndex = beforeId === null ? toArc.quests.length : toArc.quests.findIndex((item) => item.id === beforeId)
	const toQuests = [...toArc.quests.slice(0, toIndex), quest, ...toArc.quests.slice(toIndex)]

	return arcs.map((arc) => {
		if (arc.id === fromArc.id) return { ...arc, quests: fromQuests }
		if (arc.id === toArc.id) return { ...arc, quests: toQuests }
		return arc
	})
}

export function moveArc(arcs: Arc[], arcId: string, beforeId: string | null): Arc[] {
	return moveBefore(arcs, arcId, beforeId)
}

function listTarget<T extends { id: string }>(items: T[], id: string, key: string): KeyboardTarget | null {
	const index = items.findIndex((item) => item.id === id)
	if (index < 0) return null
	if (key === "ArrowUp") {
		const previous = items[index - 1]
		return previous ? { beforeId: previous.id } : null
	}
	if (index === items.length - 1) return null
	return { beforeId: items[index + 2]?.id ?? null }
}

export function keyboardTarget(
	arcs: Arc[],
	item: KeyboardItem,
	key: string,
	{ altKey, shiftKey }: KeyboardModifiers,
): KeyboardTarget | null {
	if (!altKey || (key !== "ArrowUp" && key !== "ArrowDown")) return null

	if (item.kind === "hint") {
		const quest = arcs.flatMap((arc) => arc.quests).find((candidate) => candidate.id === item.questId)
		return quest ? listTarget(quest.hints, item.id, key) : null
	}

	if (item.kind === "quest") {
		const arcIndex = arcs.findIndex((arc) => arc.quests.some((quest) => quest.id === item.id))
		if (arcIndex < 0) return null
		if (shiftKey) {
			const targetArc = arcs[arcIndex + (key === "ArrowUp" ? -1 : 1)]
			if (!targetArc) return null
			return {
				toArcId: targetArc.id,
				beforeId: key === "ArrowUp" ? null : (targetArc.quests[0]?.id ?? null),
			}
		}
		const sourceArc = arcs[arcIndex]
		if (!sourceArc) return null
		const target = listTarget(sourceArc.quests, item.id, key)
		return target ? { toArcId: sourceArc.id, beforeId: target.beforeId } : null
	}

	return listTarget(arcs, item.id, key)
}
