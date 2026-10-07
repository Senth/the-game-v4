import { redirect } from "next/navigation"
import { getAdmin } from "@/lib/db/admins"
import { getTeam } from "@/lib/db/teams"
import type { Admin, Team } from "@/lib/domain/schemas"
import { getSession } from "./session"

export async function requireAdmin(): Promise<Admin> {
	const { kind, id } = await getSession()
	const admin = kind === "admin" && id ? await getAdmin(id) : null
	return admin ?? redirect("/login")
}

export async function requireTeam(): Promise<Team> {
	const { kind, id } = await getSession()
	const team = kind === "team" && id ? await getTeam(id) : null
	return team ?? redirect("/login")
}
