"use client"

import { useActionState } from "react"
import { buttonClass, inputClass, labelClass } from "@/components/auth-form"
import { type LoginState, login } from "./actions"

export function LoginForm() {
	const [state, action, pending] = useActionState<LoginState, FormData>(login, {})
	return (
		<form action={action} className="space-y-5">
			<label className="block">
				<span className={labelClass}>Name</span>
				<input
					name="name"
					required
					defaultValue={state.name}
					autoComplete="username"
					autoCapitalize="off"
					autoCorrect="off"
					spellCheck={false}
					className={inputClass}
				/>
			</label>
			<label className="block">
				<span className={labelClass}>Password</span>
				<input name="password" type="password" required autoComplete="current-password" className={inputClass} />
			</label>
			{state.error && (
				<p role="alert" className="font-cond text-sm text-warn">
					{state.error}
				</p>
			)}
			<button type="submit" disabled={pending} className={buttonClass}>
				{pending ? "Logging in…" : "Log in"}
			</button>
		</form>
	)
}
