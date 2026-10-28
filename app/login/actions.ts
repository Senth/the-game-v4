"use server"

import { redirect } from "next/navigation"
import { authenticate } from "@/lib/auth/login"
import { ensurePhoneCookie } from "@/lib/auth/phone"
import { getSession } from "@/lib/auth/session"

export type LoginState = { error?: string; name?: string }

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
	const name = String(formData.get("name") ?? "")
	const user = await authenticate(name, String(formData.get("password") ?? ""))
	if (!user) return { error: "Wrong name or password.", name }
	const session = await getSession()
	session.kind = user.kind
	session.id = user.id
	if (user.kind === "team") await ensurePhoneCookie()
	await session.save()
	redirect(user.kind === "admin" ? "/admin" : "/")
}
