"use server"

import { redirect } from "next/navigation"
import { registerTeam } from "@/lib/auth/register"
import { getSession } from "@/lib/auth/session"

export type RegisterState = { error?: string; name?: string }

const errors = {
	closed: "Registration is closed right now.",
	"invalid-name": "Team names are 1 to 30 characters.",
	"invalid-password": "Passwords need at least 4 characters.",
}

export async function register(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
	const name = String(formData.get("name") ?? "")
	const result = await registerTeam(name, String(formData.get("password") ?? ""))
	if (!result.ok) {
		const error =
			result.error === "taken" ? `${name.trim()} is taken this season. Pick another name.` : errors[result.error]
		return { error, name }
	}
	const session = await getSession()
	session.kind = "team"
	session.id = result.team._id
	await session.save()
	redirect("/")
}
