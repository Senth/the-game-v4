import { MongoServerError } from "mongodb"
import { PhoneName, randomPhoneName } from "@/lib/domain/phone-names"
import { Phone } from "@/lib/domain/schemas"
import { collections, NotFoundError } from "./collections"

export async function listTeamPhones(teamId: string): Promise<Phone[]> {
	return (await collections()).phones.find({ teamId }).toArray()
}

export async function ensurePhone(
	teamId: string,
	phoneId: string,
	now: Date,
): Promise<{ phone: Phone; created: boolean }> {
	const { phones, teams } = await collections()
	for (;;) {
		const existing = await phones.findOne({ teamId, phoneId })
		if (existing) return { phone: existing, created: false }
		const phone = Phone.parse({
			_id: crypto.randomUUID(),
			teamId,
			phoneId,
			name: randomPhoneName((await listTeamPhones(teamId)).map((phone) => phone.name)),
			lastSeenAt: now,
			createdAt: now,
		})
		try {
			const result = await phones.updateOne({ teamId, phoneId }, { $setOnInsert: phone }, { upsert: true })
			if (!(await teams.findOne({ _id: teamId }, { projection: { _id: 1 } }))) {
				await removePhone(teamId, phoneId)
				throw new NotFoundError(`Team ${teamId} not found`)
			}
			if (result.upsertedCount) return { phone, created: true }
		} catch (error) {
			if (!(error instanceof MongoServerError && error.code === 11000)) throw error
		}
	}
}

export async function renamePhone(
	teamId: string,
	phoneId: string,
	name: string,
): Promise<{ ok: true; phone: Phone } | { ok: false; error: "taken" }> {
	const { phones } = await collections()
	const random = name.trim() === ""
	const parsed = random ? null : PhoneName.parse(name)
	for (;;) {
		const nextName = parsed ?? randomPhoneName((await listTeamPhones(teamId)).map((phone) => phone.name))
		try {
			const phone = await phones.findOneAndUpdate(
				{ teamId, phoneId },
				{ $set: { name: nextName } },
				{ returnDocument: "after" },
			)
			if (!phone) throw new NotFoundError(`Phone ${phoneId} not found`)
			return { ok: true, phone }
		} catch (error) {
			if (!(error instanceof MongoServerError && error.code === 11000)) throw error
			if (!random) return { ok: false, error: "taken" }
		}
	}
}

export async function touchPhone(teamId: string, phoneId: string, now: Date): Promise<void> {
	await (await collections()).phones.updateOne(
		{ teamId, phoneId, lastSeenAt: { $lte: new Date(now.getTime() - 60_000) } },
		{ $set: { lastSeenAt: now } },
	)
}

export async function removePhone(teamId: string, phoneId: string): Promise<void> {
	await (await collections()).phones.deleteOne({ teamId, phoneId })
}

export async function deleteTeamPhones(teamId: string): Promise<void> {
	await (await collections()).phones.deleteMany({ teamId })
}
