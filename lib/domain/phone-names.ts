import { z } from "zod"

export const PhoneName = z
	.string()
	.transform((value) => value.trim().normalize("NFC"))
	.pipe(z.string().min(1).max(20))

const adjectives = [
	"Bright",
	"Brave",
	"Calm",
	"Clever",
	"Cosmic",
	"Curious",
	"Daring",
	"Dazzling",
	"Eager",
	"Fancy",
	"Gentle",
	"Golden",
	"Happy",
	"Hidden",
	"Jolly",
	"Keen",
	"Kind",
	"Little",
	"Lucky",
	"Merry",
	"Mighty",
	"Nimble",
	"Noble",
	"Quiet",
	"Rapid",
	"Silver",
	"Sleepy",
	"Sneaky",
	"Sunny",
	"Swift",
	"Wild",
	"Wise",
]
const animals = [
	"Badger",
	"Bear",
	"Beaver",
	"Bison",
	"Cat",
	"Cobra",
	"Deer",
	"Dolphin",
	"Eagle",
	"Falcon",
	"Ferret",
	"Fox",
	"Gecko",
	"Hare",
	"Heron",
	"Koala",
	"Lemur",
	"Lion",
	"Lynx",
	"Moose",
	"Otter",
	"Owl",
	"Panda",
	"Parrot",
	"Puffin",
	"Raven",
	"Seal",
	"Shark",
	"Tiger",
	"Turtle",
	"Wolf",
	"Wren",
]

const nameKey = (name: string) => name.trim().normalize("NFC").toLocaleLowerCase("en")

export function samePhoneName(left: string, right: string): boolean {
	return nameKey(left) === nameKey(right)
}

export function randomPhoneName(taken: readonly string[]): string {
	const used = new Set(taken.map(nameKey))
	const start =
		Math.floor(Math.random() * adjectives.length) * animals.length + Math.floor(Math.random() * animals.length)
	const count = adjectives.length * animals.length
	const pair = (index: number) => `${adjectives[Math.floor(index / animals.length)]} ${animals[index % animals.length]}`
	for (let offset = 0; offset < count; offset++) {
		const name = pair((start + offset) % count)
		if (!used.has(nameKey(name))) return name
	}
	const base = pair(start)
	for (let suffix = 2; ; suffix++) {
		const ending = ` ${suffix}`
		const name = `${base.slice(0, 20 - ending.length)}${ending}`
		if (!used.has(nameKey(name))) return name
	}
}
