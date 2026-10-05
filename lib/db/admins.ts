import { Admin } from "@/lib/domain/schemas"
import { collections } from "./collections"

export async function createAdmin(input: Omit<Admin, "_id"> & { _id?: string }): Promise<Admin> {
	const admin = Admin.parse({ ...input, _id: input._id ?? crypto.randomUUID() })
	await (await collections()).admins.insertOne(admin)
	return admin
}

export async function getAdmin(id: string): Promise<Admin | null> {
	return (await collections()).admins.findOne({ _id: id })
}

export async function getAdminByName(name: string): Promise<Admin | null> {
	return (await collections()).admins.findOne({ name })
}
